import { Body, Container, Head, Html, Preview, Text } from 'react-email';
import { render, toPlainText } from 'react-email';

function interpolate(input: string, props: Record<string, unknown>): string {
  return input.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = key.split('.').reduce<unknown>((current, part) => {
      if (typeof current !== 'object' || current === null || !(part in current)) return undefined;
      return (current as Record<string, unknown>)[part];
    }, props);
    if (value === undefined || value === null) throw new Error(`Missing template property: ${key}`);
    if (typeof value === 'object') throw new Error(`Template property must be scalar: ${key}`);
    return String(value);
  });
}

export async function renderEmail(template: { subject: string; preheader: string | null; body: string }, props: Record<string, unknown>) {
  const subject = interpolate(template.subject, props);
  const preheader = template.preheader ? interpolate(template.preheader, props) : '';
  const body = interpolate(template.body, props);
  const markup = (
    <Html lang="en">
      <Head />
      {preheader ? <Preview>{preheader}</Preview> : null}
      <Body style={{ backgroundColor: '#f6f7f9', fontFamily: 'Arial, sans-serif', margin: 0, padding: '32px 12px' }}>
        <Container style={{ backgroundColor: '#ffffff', borderRadius: '8px', margin: '0 auto', maxWidth: '600px', padding: '32px' }}>
          {body.split('\n').map((line, index) => <Text key={index} style={{ color: '#18181b', fontSize: '15px', lineHeight: '24px' }}>{line || '\u00a0'}</Text>)}
        </Container>
      </Body>
    </Html>
  );
  const html = await render(markup);
  return { subject, preheader, html, plainText: toPlainText(html) };
}
