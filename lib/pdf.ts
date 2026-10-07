// Sunucu tarafı PDF üretimi (pdf-lib + DejaVu Sans: Türkçe/Kiril karakter desteği).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const require = createRequire(import.meta.url);

function fontPath(file: string) {
  try {
    return path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf', file);
  } catch {
    return path.join(process.cwd(), 'node_modules', 'dejavu-fonts-ttf', 'ttf', file);
  }
}

let fontCache: { regular: Buffer; bold: Buffer } | null = null;
const fonts = () => (fontCache ??= { regular: fs.readFileSync(fontPath('DejaVuSans.ttf')), bold: fs.readFileSync(fontPath('DejaVuSans-Bold.ttf')) });

const A4: [number, number] = [595.28, 841.89];
const M = 42; // kenar boşluğu
const GRAY = rgb(0.45, 0.45, 0.48);
const LINE = rgb(0.82, 0.83, 0.86);
const INK = rgb(0.08, 0.09, 0.11);

/** Basit akışlı (flow) PDF yazıcı: başlık, paragraf, tablo, imza, görsel. */
export class PdfWriter {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;
  footer: string;

  private constructor(footer: string) {
    this.footer = footer;
  }

  static async create(footer = ''): Promise<PdfWriter> {
    const w = new PdfWriter(footer);
    w.doc = await PDFDocument.create();
    w.doc.registerFontkit(fontkit);
    w.font = await w.doc.embedFont(fonts().regular, { subset: true });
    w.bold = await w.doc.embedFont(fonts().bold, { subset: true });
    w.doc.setCreator('Rent A Car Yönetim Sistemi');
    w.doc.setProducer('pdf-lib');
    w.newPage();
    return w;
  }

  get width() {
    return A4[0] - 2 * M;
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - M;
    if (this.footer) {
      this.page.drawText(this.footer, { x: M, y: 22, size: 7, font: this.font, color: GRAY });
      this.page.drawText(`Sayfa ${this.doc.getPageCount()}`, { x: A4[0] - M - 40, y: 22, size: 7, font: this.font, color: GRAY });
    }
  }

  ensure(h: number) {
    if (this.y - h < M + 20) this.newPage();
  }

  /** Metni genişliğe göre satırlara böler. */
  wrap(text: string, size: number, width: number, font = this.font): string[] {
    const out: string[] = [];
    for (const para of String(text ?? '').split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const t = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(t, size) > width && line) {
          out.push(line);
          line = word;
        } else line = t;
      }
      out.push(line);
    }
    return out;
  }

  text(text: string, o: { size?: number; bold?: boolean; color?: Awaited<ReturnType<typeof rgb>>; indent?: number; gap?: number; align?: 'left' | 'right' | 'center' } = {}) {
    const size = o.size ?? 9.5;
    const font = o.bold ? this.bold : this.font;
    const width = this.width - (o.indent ?? 0);
    for (const line of this.wrap(text, size, width, font)) {
      this.ensure(size + 3);
      const w = font.widthOfTextAtSize(line, size);
      const x = M + (o.indent ?? 0) + (o.align === 'right' ? width - w : o.align === 'center' ? (width - w) / 2 : 0);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= o.gap ?? 2;
  }

  heading(text: string, size = 12) {
    this.ensure(size + 14);
    this.y -= 6;
    this.text(text, { size, bold: true, gap: 4 });
  }

  rule() {
    this.ensure(8);
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4[0] - M, y: this.y }, thickness: 0.6, color: LINE });
    this.y -= 8;
  }

  /** İki sütunlu başlık bloğu (sol: şirket, sağ: belge bilgisi). */
  header(left: string[], right: string[]) {
    const top = this.y;
    let ly = top;
    left.forEach((l, i) => {
      const f = i === 0 ? this.bold : this.font;
      const s = i === 0 ? 13 : 8.5;
      this.page.drawText(l, { x: M, y: ly - s, size: s, font: f, color: i === 0 ? INK : GRAY });
      ly -= s + 4;
    });
    let ry = top;
    right.forEach((l, i) => {
      const f = i === 0 ? this.bold : this.font;
      const s = i === 0 ? 12 : 8.5;
      const w = f.widthOfTextAtSize(l, s);
      this.page.drawText(l, { x: A4[0] - M - w, y: ry - s, size: s, font: f, color: INK });
      ry -= s + 4;
    });
    this.y = Math.min(ly, ry) - 6;
    this.rule();
  }

  /** Anahtar-değer tablosu (2 veya 4 sütun). */
  kv(rows: [string, string][], cols: 2 | 4 = 4) {
    const size = 8.5;
    const pairs = cols === 4 ? 2 : 1;
    const colW = this.width / pairs;
    const labelW = colW * 0.38;
    for (let i = 0; i < rows.length; i += pairs) {
      const chunk = rows.slice(i, i + pairs);
      const heights = chunk.map(([, v]) => this.wrap(v || '—', size, colW - labelW - 8).length);
      const h = Math.max(...heights) * (size + 3) + 6;
      this.ensure(h);
      chunk.forEach(([k, v], j) => {
        const x = M + j * colW;
        this.page.drawText(k, { x, y: this.y - size - 2, size: size - 0.5, font: this.font, color: GRAY });
        this.wrap(v || '—', size, colW - labelW - 8).forEach((line, li) => {
          this.page.drawText(line, { x: x + labelW, y: this.y - size - 2 - li * (size + 3), size, font: this.bold, color: INK });
        });
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M, y: this.y + 2 }, end: { x: A4[0] - M, y: this.y + 2 }, thickness: 0.3, color: LINE });
    }
    this.y -= 4;
  }

  /** Tablo: son sütun sağa yaslı. widths oransal. */
  table(head: string[], rows: string[][], widths?: number[], opts: { totalRows?: number } = {}) {
    const size = 8.5;
    const ws = (widths ?? head.map(() => 1)).map((w, _, a) => (w / a.reduce((x, y) => x + y, 0)) * this.width);
    const drawRow = (cells: string[], bold: boolean, fill?: boolean) => {
      const lines = cells.map((c, i) => this.wrap(c ?? '', size, ws[i] - 8, bold ? this.bold : this.font));
      const h = Math.max(...lines.map((l) => l.length)) * (size + 3) + 6;
      this.ensure(h);
      if (fill) this.page.drawRectangle({ x: M, y: this.y - h, width: this.width, height: h, color: rgb(0.96, 0.965, 0.975) });
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((line, li) => {
          const f = bold ? this.bold : this.font;
          const right = i === cells.length - 1 && i > 0;
          const tx = right ? x + ws[i] - 4 - f.widthOfTextAtSize(line, size) : x + 4;
          this.page.drawText(line, { x: tx, y: this.y - size - 3 - li * (size + 3), size, font: f, color: INK });
        });
        x += ws[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4[0] - M, y: this.y }, thickness: 0.3, color: LINE });
    };
    drawRow(head, true, true);
    rows.forEach((r, i) => drawRow(r, !!opts.totalRows && i >= rows.length - opts.totalRows));
    this.y -= 6;
  }

  async image(data: Buffer, mime: string, maxW: number, maxH: number): Promise<PDFImage> {
    return mime === 'image/png' ? await this.doc.embedPng(data) : await this.doc.embedJpg(data);
  }

  /** Görsel ızgarası (fotoğraflar). */
  async gallery(items: { data: Buffer; mime: string; caption: string }[], perRow = 4) {
    const gap = 6;
    const w = (this.width - gap * (perRow - 1)) / perRow;
    const h = w * 0.72;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(h + 16);
      for (let j = 0; j < perRow && i + j < items.length; j++) {
        const it = items[i + j];
        const x = M + j * (w + gap);
        try {
          const img = await this.image(it.data, it.mime, w, h);
          const scale = Math.min(w / img.width, h / img.height);
          this.page.drawImage(img, { x: x + (w - img.width * scale) / 2, y: this.y - h + (h - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
        } catch {
          this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, borderColor: LINE, borderWidth: 0.5 });
        }
        this.page.drawText(it.caption.slice(0, 40), { x, y: this.y - h - 9, size: 6.5, font: this.font, color: GRAY });
      }
      this.y -= h + 16;
    }
  }

  /** İmza kutuları. */
  async signatures(boxes: { title: string; name: string; image?: { data: Buffer; mime: string } | null; meta?: string }[]) {
    const gap = 16;
    const w = (this.width - gap * (boxes.length - 1)) / boxes.length;
    const h = 70;
    this.ensure(h + 40);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const x = M + i * (w + gap);
      this.page.drawText(b.title, { x, y: this.y - 9, size: 8.5, font: this.bold, color: INK });
      if (b.image) {
        try {
          const img = await this.image(b.image.data, b.image.mime, w, h - 10);
          const scale = Math.min(w / img.width, (h - 14) / img.height);
          this.page.drawImage(img, { x, y: this.y - h, width: img.width * scale, height: img.height * scale });
        } catch {
          /* imza görseli okunamadı */
        }
      }
      this.page.drawLine({ start: { x, y: this.y - h - 2 }, end: { x: x + w, y: this.y - h - 2 }, thickness: 0.6, color: INK });
      this.page.drawText(b.name, { x, y: this.y - h - 12, size: 8, font: this.font, color: INK });
      if (b.meta) {
        this.wrap(b.meta, 6, w).forEach((l, li) => this.page.drawText(l, { x, y: this.y - h - 21 - li * 8, size: 6, font: this.font, color: GRAY }));
      }
    }
    this.y -= h + 44;
  }

  async bytes(): Promise<Buffer> {
    return Buffer.from(await this.doc.save());
  }
}
