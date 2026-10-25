import os
import re
from urllib.parse import urlparse, quote

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")}})

JENKINS_URL = os.getenv("JENKINS_URL", "http://localhost:8080").rstrip("/")
JENKINS_JOB_NAME = os.getenv("JENKINS_JOB_NAME", "cloud_deploy")
JENKINS_USER = os.getenv("JENKINS_USER", "")
JENKINS_API_TOKEN = os.getenv("JENKINS_API_TOKEN", "")
REQUEST_TIMEOUT = 15
BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")


def jenkins_session():
    if not JENKINS_USER or not JENKINS_API_TOKEN:
        raise RuntimeError("Jenkins credentials are not configured. Set JENKINS_USER and JENKINS_API_TOKEN in backend/.env.")
    session = requests.Session()
    session.auth = (JENKINS_USER, JENKINS_API_TOKEN)
    session.headers.update({"Accept": "application/json"})
    return session


def validate_repo_url(value):
    if not isinstance(value, str) or len(value) > 300:
        return None, "Enter a valid GitHub repository URL."
    parsed = urlparse(value.strip())
    if parsed.scheme != "https" or parsed.netloc.lower() != "github.com":
        return None, "Only public HTTPS GitHub repository URLs are supported (https://github.com/owner/repo)."
    if parsed.query or parsed.fragment:
        return None, "Repository URL must not contain query parameters or fragments."
    path = parsed.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    parts = path.split("/")
    if len(parts) != 2 or not all(re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in parts):
        return None, "Use a repository URL in the form https://github.com/owner/repo."
    if parts[0] in {".", ".."} or parts[1] in {".", ".."}:
        return None, "Invalid repository path."
    return f"https://github.com/{parts[0]}/{parts[1]}.git", None


def job_url():
    # Keep the job name to one Jenkins job segment; folder jobs need an explicit nested path implementation.
    if not re.fullmatch(r"[A-Za-z0-9_. -]{1,100}", JENKINS_JOB_NAME):
        raise RuntimeError("JENKINS_JOB_NAME must be a single job name (not a folder path).")
    return f"{JENKINS_URL}/job/{quote(JENKINS_JOB_NAME, safe='')}"


def jenkins_request(method, url, **kwargs):
    session = jenkins_session()
    # Jenkins may require a CSRF crumb for POST requests. Fetch it first.
    if method.upper() == "POST":
        crumb_response = session.get(f"{JENKINS_URL}/crumbIssuer/api/json", timeout=REQUEST_TIMEOUT)
        if crumb_response.status_code == 200:
            crumb = crumb_response.json()
            session.headers[crumb["crumbRequestField"]] = crumb["crumb"]
        elif crumb_response.status_code not in (404, 403):
            crumb_response.raise_for_status()
    response = session.request(method, url, timeout=REQUEST_TIMEOUT, allow_redirects=False, **kwargs)
    if response.status_code in (401, 403):
        raise PermissionError("Jenkins rejected the credentials or permissions. Check the API token and job build/read permissions.")
    return response


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "CloudDeploy API"})


@app.get("/api/overview")
def overview():
    try:
        response = jenkins_request("GET", f"{job_url()}/api/json?tree=name,lastBuild[number,result,building,url,timestamp,duration]")
        if response.status_code == 404:
            return jsonify({"error": "Jenkins job not found. Check JENKINS_JOB_NAME."}), 404
        response.raise_for_status()
        data = response.json()
        return jsonify({
            "jenkins": "connected",
            "job": data.get("name"),
            "lastBuild": data.get("lastBuild"),
        })
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except requests.RequestException:
        return jsonify({"error": "Could not reach Jenkins. Check JENKINS_URL and ensure Jenkins is running."}), 502
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@app.post("/api/deploy")
def deploy():
    body = request.get_json(silent=True) or {}
    repo_url, error = validate_repo_url(body.get("repoUrl"))
    if error:
        return jsonify({"error": error}), 400

    branch = body.get("branch", "main")
    if not isinstance(branch, str) or not BRANCH_PATTERN.fullmatch(branch) or ".." in branch or branch.endswith("/") or "//" in branch:
        return jsonify({"error": "Branch name is invalid."}), 400

    target = body.get("target", "local")
    if target not in ("local", "aws"):
        return jsonify({"error": "Target must be 'local' or 'aws'."}), 400

    # AWS builds run repository-controlled Dockerfiles with deployment permissions.
    # Only allow repositories explicitly approved by the operator for AWS.
    if target == "aws":
        allowed = {
            item.strip().lower()
            for item in os.getenv("ALLOWED_AWS_REPOS", "").split(",")
            if item.strip()
        }
        repo_slug = repo_url.removeprefix("https://github.com/").removesuffix(".git").lower()
        if not allowed or repo_slug not in allowed:
            return jsonify({
                "error": "This repository is not approved for AWS deployment. Add its owner/repo slug to ALLOWED_AWS_REPOS in backend/.env only after reviewing the code."
            }), 403

    try:
        response = jenkins_request(
            "POST",
            f"{job_url()}/buildWithParameters",
            params={"REPO_URL": repo_url, "BRANCH": branch, "DEPLOY_TARGET": target},
        )
        if response.status_code not in (200, 201, 202):
            detail = response.text[:300] if response.text else "No details returned."
            return jsonify({"error": f"Jenkins did not queue the build (HTTP {response.status_code}). Ensure the job defines REPO_URL, BRANCH, and DEPLOY_TARGET parameters. {detail}"}), 502

        queue_url = response.headers.get("Location")
        if not queue_url:
            return jsonify({"status": "queued", "message": "Jenkins accepted the request, but did not return a queue URL."}), 202

        # Queue URL comes from Jenkins; return only its queue ID, not an arbitrary URL for the browser to call.
        match = re.search(r"/queue/item/(\d+)/?$", urlparse(queue_url).path)
        if not match:
            return jsonify({"status": "queued", "message": "Jenkins accepted the request. Use Jenkins to inspect the queue."}), 202
        return jsonify({"status": "queued", "queueId": int(match.group(1)), "repoUrl": repo_url, "branch": branch, "target": target}), 202
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except requests.RequestException:
        return jsonify({"error": "Could not reach Jenkins. Check Jenkins URL/network connectivity."}), 502
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@app.get("/api/queue/<int:queue_id>")
def queue_status(queue_id):
    try:
        response = jenkins_request("GET", f"{JENKINS_URL}/queue/item/{queue_id}/api/json")
        if response.status_code == 404:
            return jsonify({"error": "Queue item not found; it may have expired."}), 404
        response.raise_for_status()
        data = response.json()
        executable = data.get("executable")
        result = {"cancelled": data.get("cancelled", False), "why": data.get("why"), "building": executable is None and not data.get("cancelled", False)}
        if executable:
            result["buildNumber"] = executable.get("number")
        return jsonify(result)
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except requests.RequestException:
        return jsonify({"error": "Could not retrieve Jenkins queue status."}), 502
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@app.get("/api/builds/<int:build_number>")
def build_status(build_number):
    try:
        response = jenkins_request("GET", f"{job_url()}/{build_number}/api/json?tree=number,result,building,url,timestamp,duration,displayName")
        if response.status_code == 404:
            return jsonify({"error": "Build not found."}), 404
        response.raise_for_status()
        data = response.json()
        return jsonify({key: data.get(key) for key in ("number", "result", "building", "url", "timestamp", "duration", "displayName")})
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except requests.RequestException:
        return jsonify({"error": "Could not retrieve build status."}), 502
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5002"))
    app.run(host="127.0.0.1", port=port, debug=False)
