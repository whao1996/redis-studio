import { useRef, type ReactNode } from "react";

function highlightJsonSource(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      tokens.push(text.slice(last, match.index));
    }

    if (match[1] !== undefined) {
      tokens.push(
        <span key={index++} className={match[2] ? "json-tree-key" : "json-tree-string"}>
          {match[1]}
        </span>
      );
      if (match[2]) tokens.push(match[2]);
    } else if (match[3] !== undefined) {
      tokens.push(
        <span key={index++} className={match[3] === "null" ? "json-tree-null" : "json-tree-boolean"}>
          {match[3]}
        </span>
      );
    } else {
      tokens.push(
        <span key={index++} className="json-tree-number">
          {match[0]}
        </span>
      );
    }

    last = pattern.lastIndex;
  }

  tokens.push(text.slice(last));
  return tokens;
}

export default function JsonSourceEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const preRef = useRef<HTMLPreElement>(null);

  return (
    <div className="json-source-editor">
      <pre className="json-source-highlight" ref={preRef} aria-hidden="true">
        {highlightJsonSource(value)}
        {"\n"}
      </pre>
      <textarea
        className="json-source-input"
        value={value}
        wrap="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          const pre = preRef.current;
          if (!pre) return;
          pre.scrollTop = event.currentTarget.scrollTop;
          pre.scrollLeft = event.currentTarget.scrollLeft;
        }}
      />
    </div>
  );
}
