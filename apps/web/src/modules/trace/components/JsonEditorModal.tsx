import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from '@/shared/components/ui/button';
import { X, Save } from 'lucide-react';

export function JsonEditorModal({
  initialData,
  onSave,
  onClose,
  title = "Edit Record Data"
}: {
  readonly initialData: unknown;
  readonly onSave: (data: unknown) => Promise<void>;
  readonly onClose: () => void;
  readonly title?: string;
}) {
  const [jsonString, setJsonString] = useState(() => JSON.stringify(initialData, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setError(null);
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      setError('Invalid JSON format');
      return;
    }

    setSaving(true);
    try {
      await onSave(parsed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-xl shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        
        <div className="flex-1 p-0 overflow-hidden flex flex-col min-h-[400px] border-y border-border relative">
          <Editor
            height="100%"
            defaultLanguage="json"
            theme="vs-dark"
            value={jsonString}
            onChange={(val) => setJsonString(val ?? '')}
            options={{
              minimap: { enabled: false },
              formatOnPaste: true,
              formatOnType: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 16, bottom: 16 }
            }}
          />
          {error && <div className="text-destructive text-sm mt-2">{error}</div>}
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2 bg-muted/5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="default" onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 mr-2" /> {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
