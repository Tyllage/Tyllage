import { Badge } from './ui.jsx';
import { Icons } from './Icons.jsx';

/**
 * Shows an AI assistant result honestly: whether it is a live OpenAI response or a simulation,
 * the output text, and the exact prompt (system + approved data) that is / would be sent to OpenAI.
 */
export default function AiPanel({ result, title = 'AI assistant', onClose }) {
  if (!result) return null;
  const simulated = result.mode !== 'OPENAI';
  return (
    <div className="ai-panel">
      <div className="row-between">
        <div className="row" style={{ gap: 8 }}>
          <Icons.Sparkle width={16} />
          <span className="strong small">{title}</span>
          <Badge tone={simulated ? 'medium' : 'info'}>{simulated ? 'Simulated — no OpenAI key' : `OpenAI · ${result.model}`}</Badge>
        </div>
        {onClose && (
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close AI panel"><Icons.X /></button>
        )}
      </div>
      <div className="ai-output">{result.output}</div>
      {result.note && <div className="small muted">{result.note}</div>}
      <details className="mt-8">
        <summary className="small muted" style={{ cursor: 'pointer' }}>
          {simulated ? 'Prompt that would be sent to OpenAI' : 'Prompt sent to OpenAI'}
        </summary>
        <div className="small strong mt-8">System instructions</div>
        <pre className="ai-prompt">{result.prompt?.system}</pre>
        <div className="small strong">Approved data (built by the Tyllage backend)</div>
        <pre className="ai-prompt">{result.prompt?.user}</pre>
      </details>
    </div>
  );
}
