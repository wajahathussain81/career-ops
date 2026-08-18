export function renderChat() {
  return `<main class="hub-main chat-page" data-chat-console>
  <section class="terminal-window" aria-label="Agent terminal">
    <header class="terminal-statusbar">
      <fieldset class="worker-toggle" aria-label="Worker">
        <legend class="sr-only">Worker</legend>
        <div class="worker-segments">
          <label class="worker-choice"><input type="radio" name="worker" value="codex" form="chat-form" checked><span>codex</span></label>
          <label class="worker-choice"><input type="radio" name="worker" value="claude" form="chat-form"><span>claude</span></label>
        </div>
      </fieldset>
      <div class="terminal-run-meta" role="status" aria-live="polite">
        <span class="terminal-run-state"><span class="terminal-state-dot" aria-hidden="true">●</span><span id="chat-state">idle</span></span>
        <time id="chat-elapsed" datetime="PT0S" hidden>00:00</time>
        <span id="chat-usage" hidden></span>
        <button id="chat-kill" type="button" disabled aria-label="Interrupt active run">^C</button>
      </div>
    </header>

    <div class="terminal-scrollback" id="chat-scrollback">
      <div id="chat-transcript" class="chat-transcript" role="log" aria-live="polite"></div>
      <button id="chat-new-output" class="terminal-new-output" type="button" hidden>▼ new output</button>
    </div>

    <form id="chat-form" class="terminal-prompt-row" autocomplete="off">
      <span class="terminal-prompt-glyph" aria-hidden="true">❯</span>
      <label class="sr-only" for="chat-prompt">Agent prompt</label>
      <span class="terminal-prompt-editor">
        <textarea id="chat-prompt" name="prompt" rows="1" placeholder=" " required spellcheck="true" aria-label="Agent prompt"></textarea>
        <span class="terminal-block-cursor" aria-hidden="true"></span>
      </span>
      <button class="sr-only" type="submit" tabindex="-1">Run</button>
    </form>
  </section>
</main>`;
}
