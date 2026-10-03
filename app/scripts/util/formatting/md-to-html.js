import dompurify from 'dompurify';
import { marked } from 'marked';

const whiteSpaceRegex = /<\/?p>|<br>|\r|\n/g;

const sanitizeConfig = {
    // notes may contain untrusted html: don't allow anything that can mimic the app ui
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option'],
    FORBID_ATTR: ['style', 'class', 'id']
};

dompurify.addHook('afterSanitizeAttributes', (node) => {
    // all links, including raw html ones, must be opened externally, not in the app window
    if (node.tagName === 'A' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noreferrer noopener');
    }
});

const MdToHtml = {
    convert(md) {
        if (!md) {
            return '';
        }
        const html = marked.parse(md, { breaks: true });
        const htmlWithoutLineBreaks = html.replace(whiteSpaceRegex, '');
        const mdWithoutLineBreaks = md.replace(whiteSpaceRegex, '');
        if (htmlWithoutLineBreaks === mdWithoutLineBreaks) {
            return { text: md };
        } else {
            const sanitized = dompurify.sanitize(html, sanitizeConfig);
            return { html: `<div class="markdown">${sanitized}</div>` };
        }
    }
};

export { MdToHtml };
