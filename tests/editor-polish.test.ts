import { describe, expect, it } from 'vitest';
import { checkEmail, checkPhone, checkUrl, splitList } from '@/profile/input-checks';
import { guessPosting } from '@/content/page-signals';

describe('profile input checks', () => {
  it('flags likely email typos and trims', () => {
    expect(checkEmail('').message).toBe('');
    expect(checkEmail('aditi@example.com').message).toBe('');
    expect(checkEmail('aditi@example').message).not.toBe('');
    expect(checkEmail('aditi example.com').message).toMatch(/spaces/);
    expect(checkEmail(' a@b.io ').normalized).toBe('a@b.io');
  });

  it('adds https:// and refuses non-web schemes', () => {
    expect(checkUrl('github.com/aditir').normalized).toBe('https://github.com/aditir');
    expect(checkUrl('https://github.com/aditir')).toEqual({ message: '' });
    expect(checkUrl('javascript:alert(1)').message).toMatch(/web links/);
    expect(checkUrl('data:text/html,hi').message).toMatch(/web links/);
    expect(checkUrl('localhost').message).not.toBe('');
  });

  it('keeps phone numbers as typed and flags only implausible ones', () => {
    expect(checkPhone('+91 98450 12345')).toEqual({ message: '' });
    expect(checkPhone('(415) 555-0100 ext 12')).toEqual({ message: '' });
    expect(checkPhone('12345').message).toMatch(/short/);
    expect(checkPhone('call me maybe').message).not.toBe('');
    expect(checkPhone('+91 98450 12345').normalized).toBeUndefined();
  });

  it('splits pasted skill lists and skips duplicates', () => {
    expect(splitList('Python, Go; SQL\nReact • go', ['sql'])).toEqual(['Python', 'Go', 'React']);
    expect(splitList(' , ;; ')).toEqual([]);
  });
});

describe('posting guess for history', () => {
  it('reads Greenhouse-style titles', () => {
    document.title = 'Job Application for Software Engineer at Acme';
    document.body.innerHTML = '<h1>Software Engineer</h1>';
    expect(guessPosting(document)).toEqual({ company: 'Acme', role: 'Software Engineer' });
  });

  it('prefers og:site_name and falls back to the title tail', () => {
    document.head.innerHTML = '<meta property="og:site_name" content="Globex">';
    document.title = 'Data Engineer | Globex Careers';
    document.body.innerHTML = '<h1>Data Engineer</h1>';
    expect(guessPosting(document)).toEqual({ company: 'Globex', role: 'Data Engineer' });
    document.head.innerHTML = '';
    document.title = 'Data Engineer | Globex Careers';
    expect(guessPosting(document).company).toBe('Globex');
  });

  it('caps what it keeps', () => {
    document.title = 'x';
    document.body.innerHTML = `<h1>${'a'.repeat(500)}</h1>`;
    expect(guessPosting(document).role.length).toBe(120);
  });
});
