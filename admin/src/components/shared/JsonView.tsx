const JsonView = ({ value, className }: { value: unknown; className?: string }) => (
  <pre className={`bg-muted/50 border-border max-h-96 overflow-auto rounded-lg border p-4 font-mono text-xs leading-5 ${className ?? ''}`}>
    {JSON.stringify(value, null, 2)}
  </pre>
)

export default JsonView
