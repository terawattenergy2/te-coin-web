const downloadSalesWorkbook = (() => {
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const encoder = new TextEncoder();
  const xml = text => E(String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, ''));
  const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    return value;
  });

  // ZIP store entries are sufficient for this report and avoid a browser dependency.
  function zip(files) {
    const entries = [];
    const directory = [];
    let offset = 0;
    let directorySize = 0;
    for (const [path, content] of Object.entries(files)) {
      const filename = encoder.encode(path);
      const bytes = encoder.encode(declaration + content);
      let crc = 0xffffffff;
      for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
      const checksum = (crc ^ 0xffffffff) >>> 0;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(12, 33, true);
      local.setUint32(14, checksum, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, filename.length, true);
      entries.push(local.buffer, filename, bytes);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      new Uint8Array(central.buffer, 6, 26).set(new Uint8Array(local.buffer, 4, 26));
      central.setUint32(42, offset, true);
      directory.push(central.buffer, filename);
      directorySize += central.byteLength + filename.length;
      offset += local.byteLength + filename.length + bytes.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, directory.length / 2, true);
    end.setUint16(10, directory.length / 2, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, offset, true);
    return new Blob([...entries, ...directory, end.buffer], { type: mime });
  }

  function sheet(rows, widths) {
    const columns = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
    const data = rows.map((row, i) => {
      const rowNumber = i + 1;
      const cells = row.map((cell, j) => {
        const ref = String.fromCharCode(65 + j) + rowNumber;
        if (typeof cell === 'number' && Number.isFinite(cell)) return `<c r="${ref}"><v>${cell}</v></c>`;
        if (cell == null) return '';
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;
      }).join('');
      return `<row r="${rowNumber}">${cells}</row>`;
    }).join('');
    const last = String.fromCharCode(64 + widths.length);
    return `<worksheet xmlns="${spreadsheet}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${data}</sheetData><autoFilter ref="A1:${last}${rows.length}"/></worksheet>`;
  }

  function salesTabs() {
    const amount = basisLabel();
    const sellers = [['ชื่อเซลส์', 'ใบเสร็จรับเงิน', 'รายการ', 'ชื่อสินค้า', amount],
      ...aggregate(filtered, row => row[3]).map(item => [
        item.key, item.docs.size, item.lines, item.names.size, item.amount,
      ])];
    const products = [['สินค้า', 'ยี่ห้อ', 'หมวด', 'จำนวนแยกหน่วย', 'ใบเสร็จรับเงิน', amount],
      ...aggregate(filtered, row => row[5]).map(item => {
        const product = productMap.get(item.key);
        return [product.name, product.brand, product.category,
          [...item.units].map(([unit, count]) => `${num(count)} ${unit}`).join(' / '),
          item.docs.size, item.amount];
      })];
    const lines = [['วันที่', 'เลขใบเสร็จรับเงิน', 'เซลส์', 'ลูกค้า', 'สินค้า', 'ยี่ห้อ', 'หมวด',
      'จำนวน', 'หน่วย', 'ยอดตามรายการ', 'ก่อน VAT ที่ปันส่วน', 'สถานะ', 'รายละเอียด'],
      ...[...filtered].sort((a, b) => b[2].localeCompare(a[2]) || b[1].localeCompare(a[1])).map(row => [
        row[2], row[1], row[3], row[4], row[6], row[7], row[8], row[9], row[10], row[11], row[12],
        statusNames[row[13]] || row[13], row[17],
      ])];
    const summary = receiptSummary(filtered);
    return [
      ['สรุปใบเสร็จ', [['ตัวชี้วัด', 'ค่า'],
        [$('amountLabel').textContent, summary.total ?? 'รอตรวจ'],
        ['ใบเสร็จรับเงินที่ตรงตัวกรอง', summary.count]], [42, 24]],
      ['ยอดตามเซลส์', sellers, [36, 18, 14, 14, 42]],
      ['ยอดตามสินค้า', products, [48, 26, 34, 24, 18, 42]],
      ['รายการขาย', lines, [15, 22, 32, 40, 55, 24, 32, 12, 16, 24, 26, 22, 48]],
    ];
  }

  function makeWorkbook(tabs) {
    const names = tabs.map(([name]) => name);
    const refs = (type, targets) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${targets.map((target, i) => `<Relationship Id="rId${i + 1}" Type="${relationships}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
    const worksheetPaths = names.map((_, i) => `worksheets/sheet${i + 1}.xml`);
    const styles = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>';
    const types = ['sheet.main', ...names.map(() => 'worksheet')];
    const paths = ['xl/workbook.xml', ...worksheetPaths.map(path => 'xl/' + path)];
    return zip({
      '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${styles}${paths.map((path, i) => `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${types[i]}+xml"/>`).join('')}</Types>`,
      '_rels/.rels': refs('officeDocument', ['xl/workbook.xml']),
      'xl/workbook.xml': `<workbook xmlns="${spreadsheet}" xmlns:r="${relationships}"><bookViews><workbookView/></bookViews><sheets>${names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': refs('worksheet', worksheetPaths),
      ...Object.fromEntries(tabs.map(([, rows, widths], index) => [paths[index + 1], sheet(rows, widths)])),
    });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  $('exportExcel').addEventListener('click', () => {
    if (!filtered.length) {
      $('exportStatus').textContent = 'ไม่มีรายการที่ตรงตัวกรองสำหรับส่งออก';
      return;
    }
    download(makeWorkbook(salesTabs()), 'teracoin-sales.xlsx');
    $('exportStatus').textContent = `ส่งออก ${num(filtered.length)} รายการตามตัวกรอง`;
  });
  return (tabs, filename, includeSales = false) =>
    download(makeWorkbook(includeSales ? [...tabs, ...salesTabs()] : tabs), filename);
})();
