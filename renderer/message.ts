type MessageOptions = {
  title: string;
  message: string;
};

let currentResolver: (() => void) | null = null;
let initialized = false;

function init(): void {
  if (initialized) return;
  initialized = true;
  const backdrop = document.getElementById('messageModalBackdrop');
  const okBtn = document.getElementById('btnMessageOk');
  const close = (): void => {
    const modal = document.getElementById('messageModal');
    if (modal) modal.style.display = 'none';
    const resolver = currentResolver;
    currentResolver = null;
    resolver?.();
  };
  backdrop?.addEventListener('click', close);
  okBtn?.addEventListener('click', close);
}

export function showMessage(options: MessageOptions): Promise<void> {
  init();
  const modal = document.getElementById('messageModal');
  const titleEl = document.getElementById('messageModalTitle');
  const textEl = document.getElementById('messageModalText');
  if (!modal || !titleEl || !textEl) {
    // 保留 alert 作为降级方案
    // eslint-disable-next-line no-alert
    alert(`${options.title}\n\n${options.message}`);
    return Promise.resolve();
  }
  titleEl.textContent = options.title;
  textEl.textContent = options.message;
  (textEl as HTMLElement).scrollTop = 0;
  modal.style.display = 'flex';
  return new Promise<void>((resolve) => {
    currentResolver = resolve;
  });
}

