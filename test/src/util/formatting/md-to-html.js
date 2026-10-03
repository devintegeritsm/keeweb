import { expect } from 'chai';
import { MdToHtml } from 'util/formatting/md-to-html';

describe('MdToHtml', () => {
    it('should convert markdown', () => {
        expect(MdToHtml.convert('## head\n_italic_')).to.eql({
            html: '<div class="markdown"><h2>head</h2>\n<p><em>italic</em></p>\n</div>'
        });
    });

    it('should not add markdown wrapper tags for plaintext', () => {
        expect(MdToHtml.convert('plain\ntext')).to.eql({ text: 'plain\ntext' });
    });

    it('should convert links', () => {
        expect(MdToHtml.convert('[link](https://x)')).to.eql({
            html:
                '<div class="markdown">' +
                '<p><a href="https://x" target="_blank" rel="noreferrer noopener">link</a></p>\n' +
                '</div>'
        });
    });

    it('should open html links externally', () => {
        expect(MdToHtml.convert('**x** <a href="https://x" target="_self">link</a>')).to.eql({
            html:
                '<div class="markdown">' +
                '<p><strong>x</strong> ' +
                '<a href="https://x" target="_blank" rel="noreferrer noopener">link</a></p>\n' +
                '</div>'
        });
    });

    it('should remove scripts and javascript links', () => {
        const converted = MdToHtml.convert(
            '**x** <a href="javascript:alert(1)">a</a><img src=x onerror="alert(1)">' +
                '<script>alert(1)</script>[b](javascript:alert(1))'
        );
        expect(converted.html).to.not.match(/javascript|onerror|<script/i);
    });

    it('should remove forms, styles and attributes that can mimic the app ui', () => {
        const converted = MdToHtml.convert(
            '**x** <form action="https://x"><input type="password"><button>OK</button></form>' +
                '<style>body{display:none}</style>' +
                '<div class="modal" id="app" style="position:fixed">text</div>'
        );
        const sanitized = converted.html.replace('<div class="markdown">', '');
        expect(sanitized).to.not.match(/<form|<input|<button|<style|class=|id=|style=/i);
        expect(sanitized).to.contain('text');
    });

    it('should convert pathological markdown fast', () => {
        const start = Date.now();
        MdToHtml.convert('[x]:' + ' '.repeat(3000) + 'x ' + ' '.repeat(3000) + 'x');
        expect(Date.now() - start).to.be.below(1000);
    });
});
