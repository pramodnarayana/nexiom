import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from '@/shared/components/ui/button';
import { Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/shared/components/ui/dialog';

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
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Set initial focus to the editor container when opened
    const timer = setTimeout(() => {
      editorRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);



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
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        className="max-w-3xl max-h-[90vh] flex flex-col"
        onEscapeKeyDown={(e) => {
          // Don't close if they press escape inside the code editor
          if ((e.target as HTMLElement).closest('.monaco-editor')) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div ref={editorRef} className="flex-1 p-0 overflow-hidden flex flex-col min-h-[400px] border border-border rounded-md relative" tabIndex={-1}>
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
          {error && <div className="text-destructive text-sm mt-2 px-2">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="default" onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 mr-2" /> {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
