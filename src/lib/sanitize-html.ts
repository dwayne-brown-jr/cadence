import sanitizeHtml from "sanitize-html";

/**
 * Sanitize HTML for email templates.
 * Allowlist-based: anything not listed here (scripts, iframes, svg, forms,
 * event handlers, javascript: URLs) is removed. Covers the markup the rich
 * text editor, starter templates and AI-generated templates produce.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "div", "span", "a", "img",
      "strong", "b", "em", "i", "u", "s", "small", "sub", "sup",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "blockquote", "pre", "code",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    ],
    allowedAttributes: {
      "*": ["style", "class", "align"],
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "width", "height"],
      table: ["width", "cellpadding", "cellspacing", "border", "role"],
      td: ["width", "colspan", "rowspan", "valign"],
      th: ["width", "colspan", "rowspan", "valign"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
        "text-align": [/^(left|right|center|justify)$/],
        "text-decoration": [/^[a-z\s-]+$/i],
        "font-size": [/^\d+(\.\d+)?(px|em|rem|%)$/],
        "font-weight": [/^(normal|bold|\d{3})$/],
        "font-style": [/^(normal|italic)$/],
        "font-family": [/^[\w\s,'"-]+$/],
        "line-height": [/^\d+(\.\d+)?(px|em|rem|%)?$/],
        padding: [/^[\d\s.]+(px|em|rem|%)?[\d\s.pxemr%]*$/],
        margin: [/^[\d\s.]+(px|em|rem|%|auto)?[\d\s.pxemr%auto]*$/],
        border: [/^[\w\s#().,%-]+$/],
        "border-radius": [/^[\d\s.]+(px|em|rem|%)?[\d\s.pxemr%]*$/],
        width: [/^\d+(\.\d+)?(px|em|rem|%)?$/],
        "max-width": [/^\d+(\.\d+)?(px|em|rem|%)?$/],
        display: [/^(block|inline|inline-block|none)$/],
      },
    },
    transformTags: {
      // Links opening in a new tab must not get a handle on the opener.
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  }).trim();
}
