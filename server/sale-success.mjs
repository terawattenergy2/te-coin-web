const outcomes = new Map([
  ['approvedandprocessed', 'won'],
  ['rejected', 'lost'],
  ['void', 'excluded'],
  ['cancelled', 'excluded'],
  ['canceled', 'excluded'],
  ['draft', 'excluded'],
]);

export async function loadSaleSuccess(flow) {
  const pageSize = 200;
  const quotes = new Map();
  for (let page = 1; page <= 100; page++) {
    const result = await flow(`quotations?currentPage=${page}&pageSize=${pageSize}`);
    const list = result.data?.list;
    const total = Number(result.data?.totalDocument);
    if (result.status !== true || !Array.isArray(list) || result.data?.totalDocument == null ||
        !Number.isSafeInteger(total) || total < 0) {
      throw Error('FlowAccount ส่งรายการใบเสนอราคาไม่สำเร็จ');
    }
    for (const row of list) {
      const number = String(row.documentSerial ?? '').trim();
      const id = String(row.documentId ?? row.recordId ?? number);
      if (!id) throw Error('พบใบเสนอราคาที่ไม่มีรหัสเอกสาร');
      const status = String(row.statusString ?? '').trim();
      const outcome = row.isDelete === true ? 'excluded' : outcomes.get(status.toLowerCase()) ?? 'open';
      quotes.set(id, {
        number,
        date: String(row.publishedOn ?? row.documentDate ?? '').slice(0, 10),
        seller: String(row.salesName ?? '').trim(),
        customer: String(row.contactName ?? '').trim(),
        status,
        outcome,
      });
    }
    if (quotes.size >= total && (!total || list.length)) {
      const rows = [...quotes.values()].filter(quote => quote.outcome !== 'excluded');
      rows.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
      return {rows, loadedAt: new Date().toISOString()};
    }
    if (!list.length) break;
  }
  throw Error('FlowAccount ส่งรายการใบเสนอราคามาไม่ครบ กรุณาโหลดใหม่');
}
