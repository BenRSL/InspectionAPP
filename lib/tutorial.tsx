import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from '@react-pdf/renderer';
import { supabaseServer } from './supabase-server';

export type TutorialRole = 'inspector' | 'admin' | 'god_mode';

export type TutorialStep = {
  id: string;
  role: TutorialRole;
  step_order: number;
  title: string;
  body: string;
  image_url: string | null;
};

const ROLE_LABEL: Record<TutorialRole, string> = {
  inspector: 'Inspector',
  admin: 'Admin',
  god_mode: 'God Mode',
};

export async function fetchTutorialSteps(role: TutorialRole): Promise<TutorialStep[]> {
  const supabase = supabaseServer();
  const { data } = await supabase
    .from('tutorial_steps')
    .select('id, role, step_order, title, body, image_url')
    .eq('role', role)
    .order('step_order', { ascending: true });
  return data ?? [];
}

const COLORS = { navy: '#1A1A2E', gold: '#B08D2B' };

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: 'Helvetica', color: COLORS.navy },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 10, color: '#1A1A2E99', marginBottom: 20 },
  step: { marginBottom: 16 },
  stepTitle: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  stepNumber: { color: COLORS.gold },
  stepBody: { fontSize: 10, lineHeight: 1.5, marginBottom: 6 },
  stepImage: { maxWidth: 400, maxHeight: 240, marginTop: 4, marginBottom: 4 },
});

function TutorialDocument({ role, steps }: { role: TutorialRole; steps: TutorialStep[] }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>RSLQLD Inspection App — {ROLE_LABEL[role]} Guide</Text>
        <Text style={styles.subtitle}>
          {steps.length > 0 ? `${steps.length} step${steps.length === 1 ? '' : 's'}` : 'No steps added yet.'}
        </Text>
        {steps.map((step, i) => (
          <View key={step.id} style={styles.step}>
            <Text style={styles.stepTitle}>
              <Text style={styles.stepNumber}>{i + 1}. </Text>
              {step.title}
            </Text>
            <Text style={styles.stepBody}>{step.body}</Text>
            {step.image_url && <Image style={styles.stepImage} src={step.image_url} />}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function renderTutorialPdf(role: TutorialRole, steps: TutorialStep[]): Promise<Buffer> {
  return renderToBuffer(<TutorialDocument role={role} steps={steps} />);
}
