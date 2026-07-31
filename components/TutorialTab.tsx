'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Role = 'inspector' | 'admin' | 'god_mode';

type Step = {
  id: string;
  role: Role;
  step_order: number;
  title: string;
  body: string;
  image_url: string | null;
};

const ROLE_LABEL: Record<Role, string> = { inspector: 'Inspector', admin: 'Admin', god_mode: 'God Mode' };

export default function TutorialTab() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [role, setRole] = useState<Role>('inspector');
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [emailPromptId, setEmailPromptId] = useState<'sending' | null>(null);
  const [emailAddress, setEmailAddress] = useState('');
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  async function load(forRole: Role) {
    setLoading(true);
    const { data } = await supabase
      .from('tutorial_steps')
      .select('id, role, step_order, title, body, image_url')
      .eq('role', forRole)
      .order('step_order', { ascending: true });
    setSteps(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load(role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  async function addStep() {
    const nextOrder = steps.length > 0 ? Math.max(...steps.map((s) => s.step_order)) + 1 : 1;
    const { data, error } = await supabase
      .from('tutorial_steps')
      .insert({ role, step_order: nextOrder, title: 'New step', body: '' })
      .select('id, role, step_order, title, body, image_url')
      .single();
    if (!error && data) setSteps((prev) => [...prev, data]);
  }

  async function updateStep(id: string, patch: Partial<Pick<Step, 'title' | 'body'>>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    await supabase.from('tutorial_steps').update(patch).eq('id', id);
  }

  async function deleteStep(id: string) {
    if (!window.confirm('Delete this step?')) return;
    setSteps((prev) => prev.filter((s) => s.id !== id));
    await supabase.from('tutorial_steps').delete().eq('id', id);
  }

  async function moveStep(id: string, direction: -1 | 1) {
    const idx = steps.findIndex((s) => s.id === id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= steps.length) return;

    const a = steps[idx];
    const b = steps[swapIdx];
    const reordered = [...steps];
    reordered[idx] = { ...b };
    reordered[swapIdx] = { ...a };
    setSteps(reordered);

    await Promise.all([
      supabase.from('tutorial_steps').update({ step_order: b.step_order }).eq('id', a.id),
      supabase.from('tutorial_steps').update({ step_order: a.step_order }).eq('id', b.id),
    ]);
  }

  async function uploadImage(id: string, file: File) {
    setUploadingId(id);
    try {
      const path = `${role}/${id}/${crypto.randomUUID()}.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from('tutorial-images')
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (uploadErr) throw uploadErr;

      const publicUrl = supabase.storage.from('tutorial-images').getPublicUrl(path).data.publicUrl;
      setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, image_url: publicUrl } : s)));
      await supabase.from('tutorial_steps').update({ image_url: publicUrl }).eq('id', id);
    } catch {
      // Non-fatal — the step still saves without an image; admin can retry.
    } finally {
      setUploadingId(null);
    }
  }

  async function sendEmail() {
    if (!emailAddress) return;
    setEmailPromptId('sending');
    setEmailStatus(null);
    try {
      const res = await fetch(`/api/tutorial/${role}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail: emailAddress }),
      });
      const result = await res.json();
      setEmailStatus(res.ok ? `Sent (test mode → ${result.sentTo?.join(', ')})` : result.error);
    } catch (err) {
      setEmailStatus(err instanceof Error ? err.message : 'Could not send.');
    } finally {
      setEmailPromptId(null);
    }
  }

  return (
    <div>
      <h2 className="font-display font-bold text-rsl-navy mb-1">Tutorial System</h2>
      <p className="text-sm text-rsl-navy/50 mb-6">
        Role-aware walkthroughs for Inspector, Admin, and God Mode. Editable here — no code required.
      </p>

      <div className="flex gap-2 mb-4">
        {(['inspector', 'admin', 'god_mode'] as Role[]).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
              role === r ? 'bg-rsl-blue text-white' : 'bg-rsl-navy/5 text-rsl-navy/60'
            }`}
          >
            {ROLE_LABEL[r]} Guide
          </button>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <a
          href={`/api/tutorial/${role}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-rsl-blue hover:underline"
        >
          Download PDF
        </a>
        <button
          onClick={() => setEmailPromptId('sending')}
          className="text-xs font-semibold text-rsl-blue hover:underline"
        >
          Email guide
        </button>
      </div>

      {emailPromptId && (
        <div className="bg-rsl-navy/5 rounded-xl p-3 mb-4 flex items-center gap-2">
          <input
            type="email"
            placeholder="recipient@example.com"
            value={emailAddress}
            onChange={(e) => setEmailAddress(e.target.value)}
            className="text-xs border border-rsl-navy/20 rounded-lg px-2 py-1.5 flex-1"
          />
          <button
            onClick={sendEmail}
            disabled={emailPromptId === 'sending' && !emailAddress}
            className="text-xs font-semibold bg-rsl-blue text-white px-3 py-1.5 rounded-lg"
          >
            Send
          </button>
          {emailStatus && <span className="text-xs text-rsl-navy/60">{emailStatus}</span>}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-rsl-navy/50">Loading…</p>
      ) : (
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={step.id} className="border border-rsl-navy/10 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <input
                  value={step.title}
                  onChange={(e) => updateStep(step.id, { title: e.target.value })}
                  className="font-semibold text-rsl-navy text-sm flex-1 border-b border-transparent hover:border-rsl-navy/20 focus:border-rsl-blue outline-none"
                  placeholder={`Step ${i + 1} title`}
                />
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => moveStep(step.id, -1)} disabled={i === 0} className="text-xs text-rsl-navy/40 disabled:opacity-30">
                    ↑
                  </button>
                  <button
                    onClick={() => moveStep(step.id, 1)}
                    disabled={i === steps.length - 1}
                    className="text-xs text-rsl-navy/40 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button onClick={() => deleteStep(step.id)} className="text-xs text-rsl-red font-semibold ml-2">
                    Delete
                  </button>
                </div>
              </div>
              <textarea
                value={step.body}
                onChange={(e) => updateStep(step.id, { body: e.target.value })}
                placeholder="What should this step explain?"
                rows={3}
                className="w-full text-xs border border-rsl-navy/20 rounded-lg px-2 py-1.5 mb-2"
              />
              {step.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={step.image_url} alt={step.title} className="max-w-xs rounded-lg mb-2" />
              )}
              <label className="text-xs font-semibold text-rsl-blue cursor-pointer">
                {uploadingId === step.id ? 'Uploading…' : step.image_url ? 'Replace screenshot' : 'Add screenshot'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadImage(step.id, file);
                  }}
                />
              </label>
            </div>
          ))}

          <button
            onClick={addStep}
            className="text-xs font-semibold text-rsl-blue border border-rsl-blue/30 rounded-lg px-3 py-2 w-full"
          >
            + Add step
          </button>
        </div>
      )}
    </div>
  );
}
