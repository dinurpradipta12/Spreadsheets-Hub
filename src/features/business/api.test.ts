import { afterEach, describe, expect, it } from 'vitest';
import { deleteDocument, saveDocument } from './api';
import { createDocument } from './defaults';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  get length() { return this.values.size; }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('business document recovery persistence', () => {
  it('removes a saved document from the device cache when the API is unavailable', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    });
    const workspaceId = 'workspace-delete-test';
    const document = createDocument('invoice', 'Bilik Strategi');
    const saved = await saveDocument(workspaceId, document);

    expect(saved.source).toBe('recovery');
    const deleted = await deleteDocument(workspaceId, 'invoice', document.id);
    expect(deleted).toMatchObject({ data: true, source: 'recovery' });
    expect(JSON.parse(localStorage.getItem(`business-documents:${workspaceId}:invoice`) ?? '[]')).toEqual([]);
  });
});
