import { graphBuilder } from '../GraphBuilder';

export function setupUiTracker(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Find the closest interactive element
    const interactive = target.closest('button, a, input[type="submit"], input[type="button"], [data-argus-track], [data-appsleuth-track], [role="button"]') as HTMLElement | null;
    if (!interactive) return;

    // Extract meaningful label
    let label = interactive.getAttribute('data-argus-track')
      || interactive.getAttribute('data-appsleuth-track')
      || interactive.getAttribute('data-track')
      || interactive.getAttribute('aria-label')
      || (interactive instanceof HTMLInputElement ? interactive.value : '')
      || interactive.innerText?.trim()
      || interactive.id
      || interactive.tagName.toLowerCase();

    // Sanitize label to 40 chars max
    label = label.replace(/\s+/g, ' ').slice(0, 40);

    graphBuilder.addNode({
      type: 'USER_ACTION',
      label: `Click:${label}`,
      metadata: {
        tag: interactive.tagName.toLowerCase(),
        id: interactive.id || undefined,
        className: interactive.className || undefined,
        text: label
      },
      outcome: 'SUCCESS'
    });
  };

  document.addEventListener('click', onClick, true); // Use capture phase
  return () => {
    document.removeEventListener('click', onClick, true);
  };
}
