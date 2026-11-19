import{createRequestId}from'./requestId';
test('uses native randomUUID when available',()=>{const id='11111111-1111-4111-8111-111111111111';expect(createRequestId({randomUUID:()=>id})).toBe(id);});
test('uses secure random bytes for a version 4 UUID on older mobile webviews',()=>{expect(createRequestId({getRandomValues:b=>{b.fill(255);return b;}})).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');expect(()=>createRequestId({})).toThrow('ปลอดภัย');});
