import { sanitizeFileName } from './calculations';

async function waitForImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(images.map(async (image) => {
    if (image.complete) {
      try { await image.decode(); } catch { /* Browser may not support decode for data URLs. */ }
      return;
    }
    await new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  }));
}

export async function exportDocumentPdf(container: HTMLElement, documentNumber: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const pages = Array.from(container.querySelectorAll<HTMLElement>('.document-print-page'));
  if (pages.length === 0) throw new Error('Tidak ada halaman dokumen untuk diexport.');
  await waitForImages(container);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  let hasVisibleContent = false;

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const captureHost = document.createElement('div');
    const capturePage = page.cloneNode(true) as HTMLElement;
    Object.assign(captureHost.style, {
      position: 'fixed',
      inset: '0 auto auto 0',
      width: '794px',
      height: '1123px',
      zIndex: '-2147483648',
      overflow: 'visible',
      pointerEvents: 'none',
    });
    Object.assign(capturePage.style, {
      width: '794px',
      height: '1123px',
      margin: '0',
      boxShadow: 'none',
      zoom: '1',
    });
    captureHost.appendChild(capturePage);
    document.body.appendChild(captureHost);

    try {
      await waitForImages(captureHost);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const canvas = await html2canvas(capturePage, {
        scale: 3,
        useCORS: true,
        allowTaint: false,
        backgroundColor: null,
        logging: false,
        width: 794,
        height: 1123,
        windowWidth: 794,
        windowHeight: 1123,
        scrollX: 0,
        scrollY: 0,
      });
      if (canvas.width < 100 || canvas.height < 100) throw new Error('Hasil render PDF kosong.');
      hasVisibleContent = hasVisibleContent || Boolean(page.textContent?.trim() || page.querySelector('img'));
      if (index > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    } finally {
      captureHost.remove();
    }
  }

  if (!hasVisibleContent) throw new Error('Dokumen tidak memiliki konten yang dapat diexport.');
  pdf.save(`${sanitizeFileName(documentNumber || 'dokumen')}.pdf`);
}
