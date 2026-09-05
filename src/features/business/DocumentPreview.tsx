import type { CSSProperties, RefObject } from 'react';
import { calculateDocument, formatCurrency, splitItemsForA4 } from './calculations';
import type { BusinessDocument, LineItem } from './types';

const FONT_STACKS: Record<BusinessDocument['appearance']['font'], string> = {
  'Inter/Sans': 'Inter, Arial, sans-serif',
  Arial: 'Arial, sans-serif',
  Georgia: 'Georgia, serif',
  'Times New Roman': '"Times New Roman", serif',
  'Courier New': '"Courier New", monospace',
};

function formatDate(value: string): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`));
}

function pageStyle(document: BusinessDocument): CSSProperties {
  const backgroundImage = document.appearance.backgroundImageUrl
    ? `linear-gradient(${document.appearance.backgroundColor}E8, ${document.appearance.backgroundColor}E8), url("${document.appearance.backgroundImageUrl}")`
    : 'none';
  return {
    '--doc-accent': document.appearance.accentColor,
    '--doc-text': document.appearance.textColor,
    '--doc-bg': document.appearance.backgroundColor,
    '--doc-surface': document.template?.surfaceColor ?? '#F3F4F6',
    '--doc-border': document.template?.borderColor ?? '#D7DCE4',
    '--doc-muted': document.template?.mutedColor ?? '#667085',
    '--doc-font': FONT_STACKS[document.appearance.font],
    backgroundColor: document.appearance.backgroundColor,
    backgroundImage,
  } as CSSProperties;
}

function DocumentLogo({ document }: { document: BusinessDocument }) {
  if (document.business.logoUrl) {
    return (
      <img
        className="a4-logo"
        src={document.business.logoUrl}
        alt={`Logo ${document.business.name || 'bisnis'}`}
        crossOrigin={document.business.logoUrl.startsWith('data:') ? undefined : 'anonymous'}
      />
    );
  }
  const initials = document.business.name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'BR';
  return <div className="a4-logo-fallback" aria-label="Logo belum diupload">{initials}</div>;
}

function PageHeader({ document, continuation = false }: { document: BusinessDocument; continuation?: boolean }) {
  return (
    <div className="a4-header">
      <div className="a4-brand">
        <DocumentLogo document={document} />
        <div>
          <strong>{document.business.name || 'Nama Bisnis'}</strong>
          {!continuation && <span>{document.business.address || 'Alamat bisnis'}</span>}
          <span>{[document.business.email, document.business.phone].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div className="a4-document-identity">
        <h1>{continuation ? `${document.title} · LANJUTAN` : document.title}</h1>
        <strong>{document.number}</strong>
      </div>
    </div>
  );
}

function PageFooter({ document, page, totalPages }: { document: BusinessDocument; page: number; totalPages: number }) {
  return (
    <footer className="a4-footer">
      <span>{document.footer || document.business.name}</span>
      <span>{document.number} · Halaman {page} dari {totalPages}</span>
    </footer>
  );
}

function RecipientBlock({ document }: { document: BusinessDocument }) {
  const isInvoice = document.kind === 'invoice';
  return (
    <div className="a4-recipient-grid">
      <section>
        <span className="a4-overline">{isInvoice ? 'Ditagihkan kepada' : 'Diajukan kepada'}</span>
        <h2>{document.recipient.companyName || document.recipient.contactName || 'Nama klien'}</h2>
        {document.recipient.companyName && document.recipient.contactName && <strong>{document.recipient.contactName}</strong>}
        <p>{document.recipient.address || 'Alamat penerima'}</p>
        <p>{[document.recipient.email, document.recipient.phone].filter(Boolean).join(' · ')}</p>
      </section>
      <section className="a4-date-card">
        <div><span>Tanggal</span><strong>{formatDate(document.issueDate)}</strong></div>
        <div><span>{isInvoice ? 'Jatuh tempo' : 'Berlaku sampai'}</span><strong>{formatDate(document.dueDate)}</strong></div>
        <div><span>Status</span><strong className="a4-status">{document.status.toUpperCase()}</strong></div>
      </section>
    </div>
  );
}

function GrandTotalHero({ document }: { document: BusinessDocument }) {
  const totals = calculateDocument(document);
  return (
    <div className="a4-total-hero">
      <span>{document.kind === 'invoice' ? 'Total tagihan' : 'Nilai penawaran'}</span>
      <strong>{formatCurrency(totals.grandTotal, document.currency)}</strong>
    </div>
  );
}

function ItemsTable({ document, items, continued }: { document: BusinessDocument; items: LineItem[]; continued?: boolean }) {
  return (
    <section className="a4-items-section">
      <div className="a4-section-heading">
        <h2>{continued ? 'Rincian item · lanjutan' : 'Rincian item'}</h2>
        <span>{document.currency}</span>
      </div>
      <table className="a4-items-table">
        <thead>
          <tr>
            <th>Deskripsi</th>
            <th>Qty</th>
            <th>Harga</th>
            <th>Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.description || 'Item tanpa deskripsi'}</td>
              <td>{new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(item.quantity)}</td>
              <td>{formatCurrency(item.unitPrice, document.currency)}</td>
              <td>{formatCurrency(item.quantity * item.unitPrice, document.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TotalsBlock({ document }: { document: BusinessDocument }) {
  const totals = calculateDocument(document);
  return (
    <div className="a4-summary-grid">
      <div className="a4-payment-and-notes">
        {(document.payment.bankName || document.payment.accountNumber || document.payment.instructions) && (
          <section>
            <span className="a4-overline">{document.payment.title || 'Informasi pembayaran'}</span>
            {document.payment.bankName && <strong>{document.payment.bankName}</strong>}
            {document.payment.accountName && <p>a.n. {document.payment.accountName}</p>}
            {document.payment.accountNumber && <p>{document.payment.accountNumber}</p>}
            {document.payment.instructions && <p>{document.payment.instructions}</p>}
          </section>
        )}
        {document.notes && (
          <section>
            <span className="a4-overline">{document.kind === 'invoice' ? 'Catatan invoice' : 'Keterangan penawaran'}</span>
            <p className="a4-preline">{document.notes}</p>
          </section>
        )}
      </div>
      <div className="a4-totals">
        <div><span>Subtotal</span><strong>{formatCurrency(totals.subtotal, document.currency)}</strong></div>
        {document.discountPercent > 0 && (
          <div><span>Diskon ({document.discountPercent}%)</span><strong>- {formatCurrency(totals.discountAmount, document.currency)}</strong></div>
        )}
        {document.taxPercent > 0 && (
          <div><span>Pajak ({document.taxPercent}%)</span><strong>{formatCurrency(totals.taxAmount, document.currency)}</strong></div>
        )}
        <div className="a4-grand-total"><span>Total akhir</span><strong>{formatCurrency(totals.grandTotal, document.currency)}</strong></div>
      </div>
    </div>
  );
}

function TermsBlock({ document }: { document: BusinessDocument }) {
  if (!document.terms) return null;
  return (
    <section className="a4-terms">
      <span className="a4-overline">Syarat & ketentuan</span>
      <p className="a4-preline">{document.terms}</p>
    </section>
  );
}

function InvoicePreview({ document }: { document: BusinessDocument }) {
  const itemPages = splitItemsForA4(document.items, 5);
  return (
    <>
      {itemPages.map((items, index) => (
        <article
          key={`invoice-${index}`}
          className={`document-print-page invoice-print-page document-template-${document.template?.variant ?? 'classic'}`}
          style={pageStyle(document)}
          data-page-number={index + 1}
        >
          <div className="a4-page-body">
            <PageHeader document={document} continuation={index > 0} />
            {index === 0 && <><RecipientBlock document={document} /><GrandTotalHero document={document} /></>}
            <ItemsTable document={document} items={items} continued={index > 0} />
            {index === itemPages.length - 1 && <TotalsBlock document={document} />}
          </div>
          <PageFooter document={document} page={index + 1} totalPages={itemPages.length} />
        </article>
      ))}
    </>
  );
}

function QuotePreview({ document }: { document: BusinessDocument }) {
  const hasAdditionalPages = document.additionalPages.length > 0;
  const itemPages = splitItemsForA4(document.items, hasAdditionalPages ? 5 : 4);
  const totalPages = itemPages.length + document.additionalPages.length + (hasAdditionalPages ? 1 : 0);

  return (
    <>
      {hasAdditionalPages && (() => {
        const pageNumber = 1;
        return (
          <article className={`document-print-page quote-print-page document-template-${document.template?.variant ?? 'classic'}`} style={pageStyle(document)} data-page-number={pageNumber}>
            <div className="a4-page-body a4-cover-body">
              <PageHeader document={document} />
              <RecipientBlock document={document} />
              <GrandTotalHero document={document} />
              <section className="a4-introduction">
                <span className="a4-overline">Pengantar dokumen</span>
                <p className="a4-preline">{document.introduction || 'Terima kasih atas kesempatan untuk menyampaikan penawaran ini. Rincian ruang lingkup dan harga tersedia pada halaman berikutnya.'}</p>
              </section>
            </div>
            <PageFooter document={document} page={pageNumber} totalPages={totalPages} />
          </article>
        );
      })()}

      {document.additionalPages
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((additionalPage, additionalIndex) => {
          const currentPage = additionalIndex + 2;
          return (
            <article key={additionalPage.id} className={`document-print-page quote-print-page document-template-${document.template?.variant ?? 'classic'}`} style={pageStyle(document)} data-page-number={currentPage}>
              <div className="a4-page-body">
                <div className="a4-additional-head">
                  <DocumentLogo document={document} />
                  <span>{document.number}</span>
                </div>
                <section className="a4-additional-content">
                  <span className="a4-overline">Bagian {additionalPage.sortOrder}</span>
                  <h1>{additionalPage.title || 'Informasi Tambahan'}</h1>
                  <p className="a4-preline">{additionalPage.content || 'Isi halaman tambahan.'}</p>
                </section>
              </div>
              <PageFooter document={document} page={currentPage} totalPages={totalPages} />
            </article>
          );
        })}

      {itemPages.map((items, index) => {
        const currentPage = (hasAdditionalPages ? document.additionalPages.length + 1 : 0) + index + 1;
        const isLast = index === itemPages.length - 1;
        return (
          <article key={`quote-items-${index}`} className={`document-print-page quote-print-page document-template-${document.template?.variant ?? 'classic'}`} style={pageStyle(document)} data-page-number={currentPage}>
            <div className="a4-page-body">
              <PageHeader document={document} continuation={index > 0 || hasAdditionalPages} />
              {!hasAdditionalPages && index === 0 && <><RecipientBlock document={document} /><GrandTotalHero document={document} /></>}
              {hasAdditionalPages && index === 0 && <h2 className="a4-detail-title">Rincian Penawaran</h2>}
              <ItemsTable document={document} items={items} continued={index > 0} />
              {isLast && <><TotalsBlock document={document} /><TermsBlock document={document} /></>}
            </div>
            <PageFooter document={document} page={currentPage} totalPages={totalPages} />
          </article>
        );
      })}
    </>
  );
}

export function DocumentA4Preview({
  document,
  containerRef,
}: {
  document: BusinessDocument;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="document-preview-panel">
      <div className="document-preview-toolbar">
        <div><strong>Live Preview A4</strong><span>794 × 1123 px · sumber PDF 210 × 297 mm</span></div>
        <span>{document.template?.name || (document.kind === 'invoice' ? 'Invoice' : 'Penawaran')}</span>
      </div>
      <div className="document-preview-scroll">
        <div className="document-pages" ref={containerRef}>
          {document.kind === 'invoice' ? <InvoicePreview document={document} /> : <QuotePreview document={document} />}
        </div>
      </div>
    </div>
  );
}
