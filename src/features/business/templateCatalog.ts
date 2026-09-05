import { supabase } from '../../lib/supabase';
import { DEFAULT_DOCUMENT_TEMPLATES } from './defaults';
import type {
  DocumentFont,
  DocumentTemplate,
  DocumentTemplateKind,
  DocumentTemplateVariant,
} from './types';

const TEMPLATE_FIELDS = [
  'id',
  'name',
  'description',
  'icon',
  'kind',
  'variant',
  'font',
  'accent_color',
  'background_color',
  'text_color',
  'surface_color',
  'border_color',
  'muted_color',
  'sort_order',
  'is_active',
  'version',
  'created_at',
  'updated_at',
].join(',');

type TemplateRow = {
  id: string;
  name: string;
  description: string;
  icon: string;
  kind: DocumentTemplateKind;
  variant: DocumentTemplateVariant;
  font: DocumentFont;
  accent_color: string;
  background_color: string;
  text_color: string;
  surface_color: string;
  border_color: string;
  muted_color: string;
  sort_order: number;
  is_active: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
};

export type TemplateCatalogResult = {
  data: DocumentTemplate[];
  source: 'server' | 'fallback';
  warning?: string;
};

function mapTemplate(row: TemplateRow): DocumentTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    icon: row.icon || 'file-text',
    kind: row.kind,
    variant: row.variant,
    font: row.font,
    accentColor: row.accent_color,
    backgroundColor: row.background_color,
    textColor: row.text_color,
    surfaceColor: row.surface_color,
    borderColor: row.border_color,
    mutedColor: row.muted_color,
    sortOrder: Number(row.sort_order ?? 0),
    isActive: Boolean(row.is_active),
    version: Number(row.version ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPayload(template: DocumentTemplate): Record<string, unknown> {
  return {
    id: template.id.trim(),
    name: template.name.trim(),
    description: template.description.trim(),
    icon: template.icon,
    kind: template.kind,
    variant: template.variant,
    font: template.font,
    accentColor: template.accentColor,
    backgroundColor: template.backgroundColor,
    textColor: template.textColor,
    surfaceColor: template.surfaceColor,
    borderColor: template.borderColor,
    mutedColor: template.mutedColor,
    sortOrder: template.sortOrder,
    isActive: template.isActive,
    version: template.version,
  };
}

export async function loadDocumentTemplates(includeInactive = false): Promise<TemplateCatalogResult> {
  let query = supabase
    .from('app_document_templates')
    .select(TEMPLATE_FIELDS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) {
    return {
      data: DEFAULT_DOCUMENT_TEMPLATES,
      source: 'fallback',
      warning: error.message,
    };
  }
  return { data: (data as unknown as TemplateRow[]).map(mapTemplate), source: 'server' };
}

export async function saveDocumentTemplate(template: DocumentTemplate): Promise<DocumentTemplate> {
  const { data, error } = await supabase.rpc('save_document_template', {
    p_template: toPayload(template),
  });
  if (error) throw new Error(error.message || 'Template gagal disimpan.');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Template tersimpan tanpa respons data.');
  return mapTemplate(row as TemplateRow);
}

export async function deleteDocumentTemplate(templateId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_document_template', { p_template_id: templateId });
  if (error) throw new Error(error.message || 'Template gagal dihapus.');
}
