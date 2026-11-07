import type { ReactNode } from 'react';

// Minimal renderer for the backend's report markdown (headings, lists, tables, bold, code).
// Builds React elements only; never injects HTML.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_$)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ source }: { source: string }) {
  const lines = source.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (/^#{1,6} /.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const text = inline(line.replace(/^#+ /, ''));
      out.push(level === 1 ? <h2 key={i}>{text}</h2> : <h3 key={i}>{text}</h3>);
      i++;
    } else if (line.trim().startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const [head, , ...body] = rows;
      out.push(
        <table key={i} className="report-table">
          <thead>
            <tr>{cells(head).map((c, k) => <th key={k}>{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, n) => (
              <tr key={n}>{cells(r).map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
    } else if (/^\s*([-*]|\d+\.) /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.) /, ''));
      const list = items.map((t, k) => <li key={k}>{inline(t)}</li>);
      out.push(ordered ? <ol key={i}>{list}</ol> : <ul key={i}>{list}</ul>);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6} |\s*\||\s*([-*]|\d+\.) )/.test(lines[i])) para.push(lines[i++].trim());
      out.push(<p key={i}>{inline(para.join(' '))}</p>);
    }
  }
  return <>{out}</>;
}
