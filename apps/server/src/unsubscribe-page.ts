const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);

const mark = `<svg class="mark" viewBox="0 0 82 82" aria-hidden="true"><g stroke="#281916" stroke-linecap="round" stroke-linejoin="round"><path d="M11 28 Q5 27 4 34 L4 47 Q5 53 11 52 L15 48 L16 32 Z" fill="#ffd43b" stroke-width="2.8"/><path d="M70 27 Q77 26 79 33 L79 46 Q78 53 72 52 L68 48 L67 32 Z" fill="#ffd43b" stroke-width="2.8"/><path d="M17 22 Q22 15 33 14 L53 13 Q64 14 69 21 L73 28 Q76 34 75 45 L74 52 Q72 60 62 61 L22 61 Q12 60 10 52 L9 37 Q9 28 17 22 Z" fill="#fffaf1" stroke-width="2.8"/><path d="M27 16 Q31 13 40 13 L55 13 Q60 14 64 17 L61 21 Q53 22 43 22 L32 21 Z" fill="#ffd43b" stroke-width="2.4"/><path d="M23 28 Q27 24 35 24 L53 23 Q62 24 66 30 Q69 34 68 45 Q67 53 59 55 L29 55 Q20 55 17 48 Q15 40 18 33 Q20 30 23 28 Z" fill="#281916" stroke="none"/><path d="M26 43 Q28 37 32 36 Q37 35 41 43 M47 42 Q49 36 53 36 Q58 36 60 42" fill="none" stroke="#ffd43b" stroke-width="4.7"/></g></svg>`;

const pageStyle = `body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:oklch(0.985 0.012 93);color:oklch(0.22 0.035 30);font:16px/1.5 "Inter Tight Variable","Inter Tight",ui-sans-serif,system-ui,sans-serif}main{width:min(100%,28rem)}header{display:flex;align-items:center;gap:10px;margin-bottom:28px}.mark{width:36px;height:36px}.brand{margin:0;font-weight:800;letter-spacing:-.04em}h1{margin:0 0 8px;font-size:2rem;line-height:1.05;letter-spacing:-.045em}p{margin:0 0 16px}.note,.help{color:oklch(0.48 0.025 35);font-size:.95rem}form{margin:8px 0 16px}button{width:100%;border:0;border-radius:999px;padding:14px 18px;background:oklch(0.26 0.05 24);color:oklch(0.99 0.015 93);font:inherit;font-weight:650;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid oklch(0.7 0.17 85);outline-offset:3px}a{color:inherit}`;

function supportLink(email: string | undefined) {
  if (!email || !/^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/.test(email)) return '';
  return `<p class="help">Need help? <!--email_off--><a href="mailto:${escapeHtml(email)}">Contact support</a><!--/email_off-->.</p>`;
}

export function renderUnsubscribePage(title: string, content: string, supportEmail?: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${pageStyle}</style></head><body><main><header>${mark}<p class="brand">Rachet</p></header><h1>${escapeHtml(title)}</h1>${content}${supportLink(supportEmail)}</main></body></html>`;
}
