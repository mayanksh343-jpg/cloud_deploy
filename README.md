# CloudDeploy

CloudDeploy is a local self-service CI/CD dashboard: React collects a repository, branch and target; Flask validates the request and securely calls Jenkins; Jenkins checks out the repository, runs supported tests, builds a Docker image, and deploys to local Docker or a configured AWS ECS service.

## Local setup (Windows PowerShell)

### 1. Configure the Flask backend

```powershell
cd backend
Copy-Item .env.example .env
notepad .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Set `JENKINS_USER` and `JENKINS_API_TOKEN` in `backend/.env`. Use a Jenkins API token, not your account password. Set `JENKINS_JOB_NAME` to the exact single job name in Jenkins. The backend listens on `http://127.0.0.1:5002`.

### 2. Start the React dashboard (a second terminal)

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL printed in the terminal, usually `http://localhost:5173`. If Flask is running on a different port, create `frontend/.env.local` with `VITE_API_BASE=http://127.0.0.1:5002`, then restart Vite.

### 3. Configure Jenkins

1. The Jenkins job must be named to match `JENKINS_JOB_NAME` and load this repository's `Jenkinsfile` from the `main` branch.
2. Ensure the job's Pipeline script is loaded from SCM (Git) and that the Jenkins agent has Git, Docker CLI plus daemon access, Python 3, and the Python venv module.
3. Run the Jenkins job once manually so Jenkins loads the new `REPO_URL`, `BRANCH`, and `DEPLOY_TARGET` parameters.
4. Create a Jenkins user API token and use it in the backend `.env`. Grant only the job permissions needed to build and read status.

The Flask API uses Jenkins Basic authentication with the API token, retrieves a CSRF crumb for POST requests when Jenkins provides one, and never sends the token to React.

## AWS target prerequisites

AWS is not configured automatically. Before choosing AWS, configure the Jenkins agent with AWS CLI and an IAM role/credential provider that has only the required ECR and ECS permissions. Set these variables in the Jenkins agent/job environment:

- `AWS_REGION` — e.g. `ap-south-1`
- `ECR_REPOSITORY` — an existing ECR repository name
- `ECS_CLUSTER` — an existing ECS cluster
- `ECS_SERVICE` — an existing ECS service

The ECS service's task definition must already reference the same ECR image as `<account>.dkr.ecr.<region>.amazonaws.com/<ECR_REPOSITORY>:latest`, and the task execution role must be able to pull it. The pipeline pushes a build-number tag and `latest`, then requests an ECS deployment and waits for the service to become stable.

For security, add reviewed repository slugs to `ALLOWED_AWS_REPOS` in `backend/.env`, e.g. `owner/repository,team/another-app`. AWS deployment is denied if the allowlist is empty. Do not run untrusted repository code on an agent that has access to production AWS credentials. Prefer isolated, ephemeral agents and least-privilege IAM.

## Current limitations

- The current backend accepts public HTTPS GitHub repository URLs in `owner/repo` form. Private repositories need a separately configured secure Git credential flow.
- The pipeline expects a Dockerfile in the repository root or a subdirectory. It automatically runs Python `unittest` tests only when `requirements.txt` and `test*.py` files are found.
- Local deployment assumes the app listens on container port 5000 and exposes `/health`. Adjust the Jenkinsfile for other app runtimes/ports/health routes.
- AWS deployment assumes the existing ECS task definition uses the `latest` image tag. For production, prefer immutable image tags and update/register the task definition with the exact build-number image.
- A build being queued or started does not mean the deployment succeeded. The dashboard polls Jenkins for the actual result.
