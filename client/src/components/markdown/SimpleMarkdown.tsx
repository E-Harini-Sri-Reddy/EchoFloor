import type { ReactNode } from "react";

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

/** Safe subset: paragraphs, bold, simple lists. No raw HTML. */
export function SimpleMarkdown({ source }: { source: string }) {
  const text = stripHtml(source);
  const blocks = text.split(/\n{2,}/);
  const nodes: ReactNode[] = [];

  blocks.forEach((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return;

    const allList = lines.every((line) => /^[-*+]\s+/.test(line));
    if (allList) {
      nodes.push(
        <ul key={`ul-${index}`}>
          {lines.map((line, lineIndex) => (
            <li key={lineIndex}>{inlineMarkdown(line.replace(/^[-*+]\s+/, ""))}</li>
          ))}
        </ul>,
      );
      return;
    }

    lines.forEach((line, lineIndex) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        const content = inlineMarkdown(heading[2]);
        if (level <= 2) nodes.push(<h3 key={`h-${index}-${lineIndex}`}>{content}</h3>);
        else nodes.push(<h4 key={`h-${index}-${lineIndex}`}>{content}</h4>);
        return;
      }
      nodes.push(<p key={`p-${index}-${lineIndex}`}>{inlineMarkdown(line)}</p>);
    });
  });

  return <div className="markdown-body stack">{nodes}</div>;
}

function inlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(<strong key={key}>{match[1]}</strong>);
    key += 1;
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
