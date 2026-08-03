'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function SiteNotes({ siteId }: { siteId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data } = await supabase
        .from('site_notes')
        .select('note')
        .eq('site_id', siteId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (data?.note) {
        setNote(data.note);
        setOpen(true); // there's already something here — don't hide it behind a collapse
      }
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  async function save() {
    if (!userId) return;
    setSaveStatus('saving');
    await supabase
      .from('site_notes')
      .upsert({ user_id: userId, site_id: siteId, note, updated_at: new Date().toISOString() }, { onConflict: 'user_id,site_id' });
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1500);
  }

  if (!loaded) return null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-rsl-navy/50 hover:text-rsl-navy/70 flex items-center gap-1"
      >
        {open ? '▾' : '▸'} My notes for this site
        {!open && note && <span className="w-1.5 h-1.5 rounded-full bg-rsl-gold ml-1" />}
      </button>
      {open && (
        <div className="mt-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={save}
            placeholder="Only you can see this — e.g. access door code, where the switchboard or shut-off is, parking notes, padlock combinations…"
            rows={3}
            className="w-full text-xs border border-rsl-navy/15 rounded-lg px-3 py-2 text-rsl-navy/80 placeholder:text-rsl-navy/30"
          />
          <p className="text-[10px] text-rsl-navy/30 mt-1">
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved.' : 'Private — saves automatically.'}
          </p>
        </div>
      )}
    </div>
  );
}
