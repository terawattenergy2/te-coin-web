const {documents,normalizeReceipt}=require('./flowaccountDomain');
const product={id:1,name:'Battery',quantity:'2',pricePerUnit:'100',total:'200',discountAmount:'0'};
const direct={documentId:10,documentType:'9',contactId:90,contactName:'EPC A',status:'5',statusString:'paid',grandTotal:'214',payments:{collected:'214',remainingCollected:'0'},isVatInclusive:'false',discountAmount:'0',discountPercentage:'0',totalAfterDiscount:'200',totalWithoutVat:'200',items:[product]};
const normalize=r=>normalizeReceipt(r,'seller','test');
test('normalizes a fully paid receipt and stable product ID',()=>{expect(normalize(direct)[0]).toMatchObject({contactId:'90',netTotal:200,saleKey:'receipt:10'});expect(normalize(direct)[0].lines[0].productKey).toBe('id:1');});
test.each([{status:'1'},{payments:{collected:'100'}},{isVatInclusive:'true'},{discountAmount:'5'},{contactId:null},{items:[{...product,quantity:'0.5'}]}])('holds unsupported or unpaid data %j',patch=>expect(()=>normalize({...direct,...patch})).toThrow());
test('follows fully settled tax invoice rather than treating references as products',()=>{
 const receipt={...direct,items:[{documentId:500,documentType:7,documentGrandTotal:214,documentPaymentAmount:214,partialAmount:0}]};
 const invoice={...direct,documentId:500,status:'9',statusString:'invoiceReceived'};
 expect(normalizeReceipt(receipt,'seller','test',{'500':invoice})[0].saleKey).toBe('invoice:500');
 expect(()=>normalizeReceipt(receipt,'seller','test',{'500':{...invoice,contactId:91}})).toThrow(/บริษัท/);
 expect(()=>normalizeReceipt({...receipt,items:[{...receipt.items[0],documentPaymentAmount:100}]},'seller','test',{'500':invoice})).toThrow();
});
test('never merges two same-name EPC contacts',()=>expect(normalize({...direct,contactId:91})[0].contactId).not.toBe(normalize(direct)[0].contactId));
test('reads list and detail wrappers without mistaking product items for receipts',()=>{expect(documents({data:{list:[direct]}})).toEqual([direct]);expect(documents({data:direct})).toEqual([direct]);});

test('uses receipt line totals when header VAT base has a deduction',()=>expect(normalize({...direct,totalWithoutVat:'60'})[0]).toMatchObject({netTotal:200,headerDifference:140}));
