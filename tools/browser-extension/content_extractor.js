/**
 * Argus Browser Extension — Content Extractor
 * Injected into active webpage to harvest structural and behavioral signals.
 */
(() => {
  const result = {
    url: window.location.href,
    origin: window.location.origin,
    pathname: window.location.pathname,
    title: document.title || 'Web Application',
    metaDescription: '',
    headings: [],
    buttons: [],
    forms: [],
    scriptEndpoints: []
  };

  // 1. Meta description
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    result.metaDescription = metaDesc.getAttribute('content') || '';
  }

  // 2. Headings (H1, H2) for contextual understanding
  document.querySelectorAll('h1, h2').forEach(h => {
    const text = h.innerText.trim();
    if (text && text.length < 80) {
      result.headings.push(text);
    }
  });

  // 3. Interactive Buttons & Triggers
  const buttonEls = document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a.btn, a.button');
  buttonEls.forEach(btn => {
    let label = btn.getAttribute('data-argus-track')
      || btn.getAttribute('data-track')
      || btn.getAttribute('data-testid')
      || btn.getAttribute('aria-label')
      || (btn instanceof HTMLInputElement ? btn.value : '')
      || btn.innerText?.trim()
      || btn.id
      || '';

    label = label.replace(/\s+/g, ' ').slice(0, 40);
    if (label && !result.buttons.some(b => b.label === label)) {
      result.buttons.push({
        label,
        id: btn.id || null,
        className: btn.className ? String(btn.className).slice(0, 50) : null
      });
    }
  });

  // 4. Forms and Input Fields
  document.querySelectorAll('form').forEach((form, idx) => {
    const inputs = [];
    form.querySelectorAll('input, select, textarea').forEach(inp => {
      if (inp.type !== 'hidden') {
        inputs.push({
          type: inp.type || 'text',
          name: inp.name || inp.id || 'field',
          required: inp.hasAttribute('required'),
          placeholder: inp.getAttribute('placeholder') || ''
        });
      }
    });

    result.forms.push({
      id: form.id || `form_${idx + 1}`,
      action: form.action || '',
      method: (form.method || 'GET').toUpperCase(),
      fieldsCount: inputs.length,
      sampleFields: inputs.slice(0, 5)
    });
  });

  // 5. Script Endpoint Discovery
  document.querySelectorAll('script').forEach(script => {
    const text = script.textContent || '';
    if (text.length > 0 && text.length < 50000) {
      const matches = text.match(/(?:fetch|\.get|\.post|\.put|\.delete)\s*\(\s*['"`]([^'"`]+)['"`]/g);
      if (matches) {
        matches.forEach(m => {
          const urlMatch = m.match(/['"`]([^'"`]+)['"`]/);
          if (urlMatch && urlMatch[1]) {
            const endpoint = urlMatch[1];
            if (endpoint.startsWith('/') || endpoint.startsWith('http')) {
              if (!result.scriptEndpoints.includes(endpoint) && !endpoint.endsWith('.js') && !endpoint.endsWith('.css')) {
                result.scriptEndpoints.push(endpoint);
              }
            }
          }
        });
      }
    }
  });

  return result;
})();
