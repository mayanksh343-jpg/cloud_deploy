import { useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, CheckCircle2, CircleAlert, Cloud, GitBranch, Github, LoaderCircle, Rocket, Server, ShieldCheck, TerminalSquare } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:5002").replace(/\/$/, "");

const stages = [
  { name: "Checkout repository", detail: "Fetch selected branch from GitHub" },
  { name: "Test application", detail: "Run repository tests when configured" },
  { name: "Build container", detail: "Build a Docker image from its Dockerfile" },
  { name: "Deploy", detail: "Deploy locally or update the configured AWS ECS service" },
  { name: "Verify", detail: "Check deployment result" },
];

function StatusPill({ status }) {
  const kind = status === "SUCCESS" ? "success" : status === "FAILURE" || status === "ABORTED" ? "failure" : "pending";
  return <span className={`status-pill ${kind}`}><span className="status-dot" />{status || "QUEUED"}</span>;
}

export default function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [target, setTarget] = useState("aws");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [build, setBuild] = useState(null);
  const [apiStatus, setApiStatus] = useState("checking");
  const pollRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((res) => { if (!res.ok) throw new Error("Backend unavailable"); return res.json(); })
      .then(() => setApiStatus("online"))
      .catch(() => setApiStatus("offline"));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status})`);
    return data;
  }

  async function startPolling(queueId) {
    setMessage("Jenkins accepted the request. Waiting for an executor…");
    const pollQueue = async () => {
      try {
        const queued = await requestJson(`${API_BASE}/api/queue/${queueId}`);
        if (queued.cancelled) {
          clearInterval(pollRef.current);
          setBuild((current) => ({ ...current, result: "ABORTED", building: false }));
          setMessage("Jenkins cancelled the queued build.");
          return;
        }
        if (queued.buildNumber) {
          clearInterval(pollRef.current);
          setBuild((current) => ({ ...current, number: queued.buildNumber, result: null, building: true }));
          setMessage(`Build #${queued.buildNumber} started. Checking its live status…`);
          pollRef.current = setInterval(async () => {
            try {
              const status = await requestJson(`${API_BASE}/api/builds/${queued.buildNumber}`);
              setBuild((current) => ({ ...current, ...status, number: status.number || queued.buildNumber }));
              if (!status.building) {
                clearInterval(pollRef.current);
                setMessage(status.result === "SUCCESS" ? "Pipeline completed successfully." : `Pipeline finished: ${status.result || "unknown result"}.`);
              }
            } catch (e) {
              clearInterval(pollRef.current);
              setError(e.message);
            }
          }, 3000);
        } else if (queued.why) {
          setMessage(queued.why);
        }
      } catch (e) {
        clearInterval(pollRef.current);
        setError(e.message);
      }
    };
    await pollQueue();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(pollQueue, 2500);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (pollRef.current) clearInterval(pollRef.current);
    setBuild(null);
    setSubmitting(true);
    try {
      const result = await requestJson(`${API_BASE}/api/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, branch, target }),
      });
      setBuild({ ...result, building: true, result: null });
      if (result.queueId !== undefined) await startPolling(result.queueId);
      else setMessage(result.message || "Jenkins accepted the request. Open Jenkins to inspect the queue.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const buildState = build?.building ? "BUILDING" : build?.result || (build ? "QUEUED" : null);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="CloudDeploy home">
          <span className="brand-mark"><Cloud size={22} /></span>
          <span>cloud<span className="brand-accent">deploy</span><small>CI/CD CONTROL PLANE</small></span>
        </a>
        <div className="topbar-right"><span className={`connection-dot ${apiStatus}`} /> API {apiStatus === "online" ? "connected" : apiStatus === "checking" ? "connecting…" : "offline"} <span className="topbar-divider" /> <ShieldCheck size={15} /> Secrets stay server-side</div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-line" /> DEVELOPER SELF-SERVICE</div>
        <h1>Ship code, <span>not toil.</span></h1>
        <p>Connect a GitHub repository and let your CI/CD pipeline test, package, and deploy your application.</p>
      </section>

      <section className="workspace">
        <div className="form-panel">
          <div className="panel-heading">
            <div className="heading-icon"><Rocket size={19} /></div>
            <div><h2>New deployment</h2><p>Configure your source and target environment.</p></div>
          </div>
          <form onSubmit={handleSubmit}>
            <label htmlFor="repoUrl">GitHub repository URL <span className="required">*</span></label>
            <div className="input-wrap"><Github size={17} /><input id="repoUrl" type="url" placeholder="https://github.com/owner/repository" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} required /></div>
            <p className="field-hint">Public GitHub repositories using HTTPS are supported by this API version.</p>

            <div className="form-row">
              <div className="field">
                <label htmlFor="branch">Branch</label>
                <div className="input-wrap"><GitBranch size={17} /><input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" maxLength={128} required /></div>
              </div>
              <div className="field">
                <label htmlFor="target">Deployment target</label>
                <div className="select-wrap"><Cloud size={17} /><select id="target" value={target} onChange={(e) => setTarget(e.target.value)}><option value="aws">AWS · ECS</option><option value="local">Local Docker</option></select></div>
              </div>
            </div>

            {target === "aws" && <div className="target-note"><Cloud size={16} /><span><strong>AWS deployment prerequisites</strong><br />Jenkins needs AWS CLI access, ECR, an existing ECS cluster/service, and IAM permissions. The backend does not configure these automatically.</span></div>}

            <button className="deploy-button" type="submit" disabled={submitting || apiStatus !== "online"}>
              {submitting ? <LoaderCircle size={17} className="spin" /> : <Rocket size={17} />}
              {submitting ? "Submitting to Jenkins…" : "Run pipeline"} <ArrowUpRight size={17} />
            </button>
            {apiStatus !== "online" && <p className="field-hint">Start the Flask backend to enable deployments.</p>}
          </form>
          {error && <div className="alert error"><CircleAlert size={18} /><span>{error}</span></div>}
          {message && <div className="alert info"><Activity size={18} /><span>{message}</span></div>}
        </div>

        <aside className="pipeline-panel">
          <div className="panel-heading">
            <div className="heading-icon violet"><TerminalSquare size={19} /></div>
            <div><h2>Pipeline workflow</h2><p>Stages configured in Jenkins</p></div>
          </div>
          <div className="stage-list">
            {stages.map((stage, index) => (
              <div className="stage" key={stage.name}>
                <div className={`stage-marker ${buildState === "SUCCESS" ? "done" : ""}`}>{buildState === "SUCCESS" ? <CheckCircle2 size={16} /> : String(index + 1).padStart(2, "0")}</div>
                <div className="stage-copy"><strong>{stage.name}</strong><span>{stage.detail}</span></div>
                {index < stages.length - 1 && <div className="stage-connector" />}
              </div>
            ))}
          </div>
          <div className="workflow-foot"><span className="workflow-led" /> <span>Jenkins pipeline</span><span className="workflow-foot-right">Jenkinsfile</span></div>
        </aside>
      </section>

      <section className="build-panel">
        <div className="build-heading"><div><div className="eyebrow">EXECUTION</div><h2>Latest run</h2></div>{buildState && <StatusPill status={buildState} />}</div>
        {!build ? (
          <div className="empty-state"><div className="empty-icon"><Activity size={22} /></div><strong>No pipeline run in this session</strong><span>Enter a repository URL above and run the pipeline to see its status here.</span></div>
        ) : (
          <div className="run-details">
            <div className="run-stat"><span>Repository</span><strong className="repo-value">{build.repoUrl || repoUrl}</strong></div>
            <div className="run-stat"><span>Branch</span><strong>{build.branch || branch}</strong></div>
            <div className="run-stat"><span>Target</span><strong>{(build.target || target).toUpperCase()}</strong></div>
            <div className="run-stat"><span>Build</span><strong>{build.number ? `#${build.number}` : "Waiting in queue"}</strong></div>
            {build.url && <a className="jenkins-link" href={build.url} target="_blank" rel="noreferrer">Open in Jenkins <ArrowUpRight size={15} /></a>}
            {build.timestamp && <div className="run-stat"><span>Started</span><strong>{new Date(build.timestamp).toLocaleString()}</strong></div>}
            {build.duration > 0 && <div className="run-stat"><span>Duration</span><strong>{(build.duration / 1000).toFixed(1)} seconds</strong></div>}
          </div>
        )}
      </section>
      <footer><span>CloudDeploy · College DevOps project</span><span><Server size={14} /> React + Flask + Jenkins + Docker</span></footer>
    </main>
  );
}
