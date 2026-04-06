import { useEffect, useState, useRef } from 'react';
import { Loader2, AlertCircle, Settings2 } from 'lucide-react';
import { Label } from '@/shared/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Input } from '@/shared/components/ui/input';
import { describeConfig, type ConfigOption } from '../api/metadata.api';

interface StitchConfigPanelProps {
  connectionId: string;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}

export function StitchConfigPanel({ connectionId, value, onChange }: StitchConfigPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<ConfigOption[]>([]);

  const loadTokenRef = useRef(0);

  useEffect(() => {
    async function load() {
      const token = ++loadTokenRef.current;
      setLoading(true);
      setError(null);
      setSchema([]); // Reset schema at start of new load

      try {
        const res = await describeConfig(connectionId);
        if (token !== loadTokenRef.current) return;
        
        setSchema(res);
      } catch (e) {
        if (token !== loadTokenRef.current) return;
        
        setSchema([]); // Explicitly clear schema on errors
        const err = e as { message?: string };
        setError(err.message || 'Failed to load configuration options');
      } finally {
        if (token === loadTokenRef.current) setLoading(false);
      }
    }
    void load();
     
  }, [connectionId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading connector configurations...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  if (schema.length === 0) {
    return (
      <div className="text-center p-8 text-muted-foreground border rounded-md border-dashed">
        <Settings2 className="h-8 w-8 mx-auto mb-3 opacity-20" />
        <p>No advanced configuration options available for this connector.</p>
      </div>
    );
  }

  const handleChange = (name: string, val: unknown) => {
    onChange({ ...value, [name]: val });
  };

  return (
    <div className="space-y-6 max-w-2xl py-4">
      {schema.map((field) => (
        <div key={field.name} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={field.name} className="font-medium text-sm">
                {field.label}
            </Label>
            {field.description && (
                <span className="text-xs text-muted-foreground">{field.description}</span>
            )}
          </div>
          
          {field.type === 'boolean' && (
            <div className="flex items-center space-x-2">
                <input
                    type="checkbox"
                    id={field.name}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    checked={value[field.name] !== undefined ? !!value[field.name] : !!field.defaultValue}
                    onChange={(e) => handleChange(field.name, e.target.checked)}
                />
                <Label htmlFor={field.name} className="text-sm font-normal cursor-pointer">
                    Enable
                </Label>
            </div>
          )}

          {field.type === 'string' && (
             <Input 
                id={field.name}
                value={(value[field.name] as string) ?? (field.defaultValue as string) ?? ''}
                onChange={(e) => handleChange(field.name, e.target.value)}
             />
          )}

          {field.type === 'select' && field.options && (
             <Select value={(value[field.name] as string) ?? (field.defaultValue as string) ?? ''} onValueChange={(v) => handleChange(field.name, v)}>
                <SelectTrigger id={field.name} className="w-full">
                    <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                    {field.options.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                </SelectContent>
             </Select>
          )}
        </div>
      ))}
    </div>
  );
}
