import React from 'react';
export default function InlineTestForm({ id = 'guide-inline-test' }: { id?: string }) {
  return <form data-inline-test="" className="reading-inline-test" action="/" method="get" noValidate>
    <label htmlFor={id}>Test your server</label>
    <div className="d-flex flex-wrap gap-2">
      <input id={id} className="form-control" name="endpoint" type="url" required placeholder="https://example.com/mcp" aria-describedby={`${id}-error`} />
      <button className="btn btn-primary" type="submit">Test it live</button>
    </div>
    <p id={`${id}-error`} data-inline-error="" role="alert" hidden>Enter a valid HTTP or HTTPS server URL.</p>
  </form>;
}
