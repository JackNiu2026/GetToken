// Local tutorial playback only. No cookie, clipboard, account or form values
// are read by this module; the media contains deliberately fictional values.
export function initKeyGuide(root = document) {
  const opener = root.querySelector('[data-key-guide-open]');
  const dialog = root.querySelector('[data-key-guide-dialog]');
  const video = root.querySelector('[data-key-guide-video]');
  const status = root.querySelector('[data-key-guide-status]');
  const transcript = root.querySelector('[data-key-guide-transcript]');
  if (!opener || !dialog || !video || !status) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const chapters = [...dialog.querySelectorAll('[data-guide-jump]')];
  let lastChapter = -1;
  function unavailable() {
    status.textContent = '视频暂时无法播放，可按下方文字步骤操作，或下载视频后观看。';
    if (transcript) transcript.open = true;
  }
  function describe() {
    const current = Math.max(0, chapters.findLastIndex(button => Number(button.dataset.guideJump) <= video.currentTime));
    if (current === lastChapter) return;
    lastChapter = current;
    chapters.forEach((button, index) => {
      if (index === current) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    status.textContent = `第 ${current + 1} / ${chapters.length} 步 · ${chapters[current]?.dataset.guideTitle || '操作演示'}`;
  }
  function play() {
    video.play()?.catch(() => {
      if (video.error) unavailable();
      else status.textContent = '点击视频中的播放按钮，或按下方文字步骤操作。';
    });
  }
  function close(focusField = false) {
    video.pause();
    dialog.close();
    if (focusField) root.querySelector('[data-code]')?.focus();
  }
  opener.addEventListener('click', () => {
    if (typeof dialog.showModal !== 'function') { window.open(video.currentSrc || video.src, '_blank', 'noopener'); return; }
    if (!dialog.open) dialog.showModal();
    if (video.readyState === 0) { video.preload = 'metadata'; video.load(); }
    describe();
    if (reduce.matches) { if (transcript) transcript.open = true; }
    else play();
  });
  dialog.querySelectorAll('[data-guide-close]').forEach(button => button.addEventListener('click', () => close()));
  dialog.querySelector('[data-guide-fill]')?.addEventListener('click', () => close(true));
  dialog.querySelector('[data-guide-replay]')?.addEventListener('click', () => { video.currentTime = 0; lastChapter = -1; describe(); play(); });
  chapters.forEach(button => button.addEventListener('click', () => {
    video.pause(); video.currentTime = Number(button.dataset.guideJump); describe();
  }));
  video.addEventListener('timeupdate', describe);
  video.addEventListener('error', unavailable);
  video.querySelectorAll('source').forEach(source => source.addEventListener('error', unavailable));
  dialog.addEventListener('cancel', () => video.pause());
  dialog.addEventListener('close', () => video.pause());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) video.pause(); });
  reduce.addEventListener('change', () => { if (reduce.matches) video.pause(); });
}
