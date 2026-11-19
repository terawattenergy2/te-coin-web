const {normalizeContact,matchContacts}=require('./epcMatch');
const contact={id:1414438,contactName:'บริษัท โอม จำกัด',contactTaxId:'9522335646666',contactBranch:'สำนักงานใหญ่'};
test('matches tax and HQ code despite company name differences',()=>expect(matchContacts({tax_id:'9522335646666',branch_code:'00000'},[contact])[0].id).toBe('1414438'));
test('never matches by company name alone or a different branch',()=>{expect(matchContacts({company_name:contact.contactName,tax_id:'9999999999999',branch_code:'00000'},[contact])).toEqual([]);expect(matchContacts({tax_id:'9522335646666',branch_code:'00001'},[contact])).toEqual([]);});
test('ambiguous company contacts remain multiple candidates for admin',()=>expect(matchContacts({tax_id:'9522335646666',branch_code:'00000'},[contact,{...contact,id:2}])).toHaveLength(2));
test('unknown free-text branch is not silently treated as head office',()=>expect(normalizeContact({...contact,contactBranch:'สาขาที่ไม่ระบุรหัส'}).branch).toBeNull());
