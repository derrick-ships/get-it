# Introduction to Markdown Support in Get It.

Get It. now accepts Markdown files in addition to PDFs and plain text. Upload a `.md` file and every concept inside it will be tagged, visualised, and wired into the knowledge graph exactly as if you had uploaded a PDF.

## How It Works

When you upload a `.md` file the server converts it to a PDF using pdfkit before the rest of the pipeline runs. This means:

- The canvas viewer renders real PDF pages.
- Tag pills are anchored to glyph coordinates from the converted document.
- All study tools — chat, flashcards, quizzes, Feynman — read extracted text.
- The knowledge graph is built from the same text the model receives.

## Supported Markdown Elements

### Headings

Three levels of heading are rendered in Helvetica Bold at decreasing sizes: 20pt for h1, 15pt for h2, and 12.5pt for h3. Deeper headings fall back to h3 sizing.

### Lists

Both ordered and unordered lists are supported with automatic bullet or number prefixes.

1. First item in an ordered list
2. Second item, demonstrating numbering
3. Third item with **inline bold** that gets flattened to plain text

- Unordered item alpha
- Unordered item beta
- Unordered item gamma

### Code Blocks

Fenced code blocks render in Courier 9pt:

```python
def fibonacci(n: int) -> int:
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
```

### Blockquotes

> A blockquote renders in Times-Italic, indented from the body text, useful for highlighting key passages or definitions.

### Horizontal Rules

---

A rule drawn above separates sections visually.

### Tables

| Element    | Font            | Size   |
|------------|-----------------|--------|
| Heading 1  | Helvetica-Bold  | 20pt   |
| Heading 2  | Helvetica-Bold  | 15pt   |
| Body text  | Times-Roman     | 11.5pt |
| Code block | Courier         | 9pt    |

## Limitations

Inline HTML is stripped and images are not embedded. If your Markdown contains CJK or Cyrillic characters a fallback substitution is applied; heavily non-Latin documents are refused with an informative error message so you know why the upload was rejected.

## Getting Started

Drop any `.md` file onto the upload zone on the home screen or use the file picker — the button now lists `.pdf`, `.txt`, and `.md` as accepted types. The resulting document will appear in your library and behave exactly like an uploaded PDF.
