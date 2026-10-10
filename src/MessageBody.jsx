import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckCircle2, AlertCircle } from 'lucide-react';
const names = { codex: 'Codex', claude: 'Claude' };
function structured(message) {
  if (!['Plan', 'Relecture', 'Relecture finale'].includes(message.phase)) return null;
  try {
    const value = JSON.parse(message.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (
      message.phase === 'Plan' &&
      typeof value.summary === 'string' &&
      Array.isArray(value.tasks) &&
      value.tasks.length <= 8 &&
      value.tasks.every((task) => typeof task.title === 'string' && names[task.owner])
    )
      return { type: 'plan', value };
    if (
      message.phase !== 'Plan' &&
      typeof value.approved === 'boolean' &&
      typeof value.summary === 'string' &&
      Array.isArray(value.issues) &&
      value.issues.every((issue) => typeof issue === 'string')
    )
      return { type: 'review', value };
  } catch {
    /* Incomplete streams and malformed responses retain ordinary Markdown. */
  }
  return null;
}
export default function MessageBody({ message, openUrl }) {
  const parsed = structured(message);
  if (!parsed)
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <button className="markdown-link" onClick={() => openUrl(href)}>
              {children}
            </button>
          ),
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {message.text || 'Analyse en cours…'}
      </ReactMarkdown>
    );
  const { type, value } = parsed;
  return (
    <div className={`structured-message ${type}`}>
      {type === 'review' ? (
        <>
          <div className={`review-verdict ${value.approved ? 'favorable' : 'changes'}`}>
            {value.approved ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
            <strong>{value.approved ? 'Avis favorable' : 'Corrections demandées'}</strong>
          </div>
          <p>{value.summary}</p>
          {!!value.issues.length && (
            <ul>
              {value.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          )}
          <small>Avis IA · état tâche indique validation finale.</small>
        </>
      ) : (
        <>
          <p>{value.summary}</p>
          <ol className="shared-plan">
            {value.tasks.map((task, index) => (
              <li key={index}>
                <div>
                  <strong>{task.title}</strong>
                  <span>{names[task.owner]}</span>
                </div>
                {Array.isArray(task.files) && (
                  <p className="shared-plan-files">
                    {task.files
                      .filter((file) => typeof file === 'string')
                      .map((file, item) => (
                        <code key={item}>{file}</code>
                      ))}
                  </p>
                )}
                {typeof task.acceptance === 'string' && <p>{task.acceptance}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
      <details className="raw-response">
        <summary>Réponse brute</summary>
        <pre>{message.text}</pre>
      </details>
    </div>
  );
}
