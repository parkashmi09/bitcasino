import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';

describe('sanitizeHtml', () => {
  it('drops script, handlers and javascript: URLs', () => {
    const out = sanitizeHtml(
      '<p onclick="x()">Hi<script>alert(1)</script></p><a href="java\tscript:alert(1)">a</a><img src="x" onerror="y()"><iframe src="//e"></iframe>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|iframe/i);
    expect(out).toContain('<p>Hi</p>');
  });

  it('keeps safe links and unwraps unknown tags', () => {
    const out = sanitizeHtml('<custom><a href="https://x.com">x</a></custom>');
    expect(out).toBe('<a href="https://x.com" rel="noopener noreferrer nofollow" target="_blank">x</a>');
  });

  it('turns plain text into escaped paragraphs', () => {
    expect(sanitizeHtml('a < b\n\nc')).toBe('<p>a &lt; b</p><p>c</p>');
    expect(sanitizeHtml('')).toBe('');
  });
});
