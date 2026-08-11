export function renderChat() {
  return `<main class="hub-main" data-chat-console>
  <p class="eyebrow">Agent console</p>
  <h1>Chat</h1>
  <p class="flag reasoned"><span class="flag-t">Guardrails</span>Runs are serialized with tracker writes and cannot submit, send, apply, or run git.</p>
  <section class="chat-panel" aria-label="Agent transcript">
    <pre id="chat-transcript" class="say chat-transcript" aria-live="polite" data-empty-state>No run yet — output will stream here.</pre>
  </section>
  <form id="chat-form" class="chat-form">
    <fieldset class="worker-toggle">
      <legend>Worker</legend>
      <div class="worker-segments">
        <label class="worker-choice"><input type="radio" name="worker" value="codex" checked><span>Codex</span></label>
        <label class="worker-choice"><input type="radio" name="worker" value="claude"><span>Claude</span></label>
      </div>
    </fieldset>
    <label class="micro-label" for="chat-prompt">Prompt</label>
    <textarea id="chat-prompt" name="prompt" rows="8" required></textarea>
    <p class="chat-actions">
      <button id="chat-send" type="submit">Send</button>
      <button id="chat-kill" type="button" disabled>Kill</button>
    </p>
    <p id="chat-note" class="flag reasoned" hidden></p>
  </form>
</main>`;
}
