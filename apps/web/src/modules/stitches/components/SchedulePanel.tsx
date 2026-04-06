import { useState } from 'react';
import { CalendarClock, Play, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/shared/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Button } from '@/shared/components/ui/button';
import { useToast } from '@/shared/hooks/use-toast';
import { updateSchedule, triggerSchedule, getSyncIntervalOptions, type StitchResponse } from '../api/stitches.api';

interface SchedulePanelProps {
  stitch: StitchResponse;
  onUpdated: (updated: StitchResponse) => void;
}

export function SchedulePanel({ stitch, onUpdated }: SchedulePanelProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const options = getSyncIntervalOptions(stitch.syncIntervalMinutes);

  const handleIntervalChange = async (val: string) => {
    setSaving(true);
    try {
      const res = await updateSchedule(stitch.id, { syncIntervalMinutes: parseInt(val, 10) });
      onUpdated(res);
      toast({ title: 'Schedule updated', description: 'The sync interval has been updated.' });
    } catch (e) {
      toast({
        title: 'Update failed',
        description: e instanceof Error ? e.message : 'Could not update interval',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      const res = await updateSchedule(stitch.id, { scheduleEnabled: enabled });
      onUpdated(res);
      toast({ title: enabled ? 'Schedule Resumed' : 'Schedule Paused' });
    } catch (e) {
      toast({
        title: 'Toggle failed',
        description: e instanceof Error ? e.message : 'Could not toggle schedule',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await triggerSchedule(stitch.id);
      toast({ title: 'Sync Triggered', description: 'A sync job has been dispatched to the queue.' });
    } catch (e) {
      // The backend currently throws NotImplementedException for this, but we'll show it gracefully
      toast({
        title: 'Trigger failed',
        description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message || (e instanceof Error ? e.message : 'Could not trigger sync'),
        variant: 'destructive',
      });
    } finally {
      setTriggering(false);
    }
  };

  return (
    <Card className="border shadow-sm">
      <CardHeader className="py-4 border-b bg-muted/20">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Execution Schedule
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-1">
              {stitch.scheduleEnabled ? 'Active' : 'Paused'}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                checked={stitch.scheduleEnabled}
                onChange={(e) => handleToggle(e.target.checked)}
                disabled={saving}
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="py-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h4 className="text-sm font-medium mb-1">Sync Frequency</h4>
            <p className="text-xs text-muted-foreground">How often the poller retrieves data.</p>
          </div>
          <div className="w-48">
            <Select
              value={stitch.syncIntervalMinutes.toString()}
              onValueChange={handleIntervalChange}
              disabled={saving || !stitch.scheduleEnabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select interval" />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value.toString()}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="bg-muted/30 p-4 rounded-md border flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-mono text-muted-foreground">LAST SYNCED</p>
            <p className="text-sm font-medium">
              {stitch.lastScheduledAt ? new Date(stitch.lastScheduledAt).toLocaleString() : 'Never'}
            </p>
          </div>
          {stitch.scheduleEnabled && (
            <div className="space-y-1 text-right">
              <p className="text-xs font-mono text-muted-foreground">STATUS</p>
              <p className="text-sm font-medium text-primary">Pending execution</p>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="bg-muted/10 border-t py-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={handleTrigger}
          disabled={triggering || saving}
        >
          {triggering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Now
        </Button>
      </CardFooter>
    </Card>
  );
}
