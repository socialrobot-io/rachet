import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'react-email';

export type ReminderEmailProps = {
  contact: { firstName: string; email?: string };
  variables: { productUrl: string };
};

export default function ReminderEmail({ contact, variables }: ReminderEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>A quick nudge to get started.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>Still there, {contact.firstName}?</Heading>
          <Text style={paragraph}>
            We noticed you have not opened the product yet. Pick it up where you left off.
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={variables.productUrl}>
              Continue setup
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>Sent by Reflow</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: '#f4f4f5',
  fontFamily: 'Arial, Helvetica, sans-serif',
  margin: '0',
  padding: '32px 12px',
};

const container = {
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  margin: '0 auto',
  maxWidth: '560px',
  padding: '32px',
};

const heading = {
  color: '#18181b',
  fontSize: '24px',
  fontWeight: '700',
  lineHeight: '32px',
  margin: '0 0 16px',
};

const paragraph = {
  color: '#3f3f46',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 24px',
};

const buttonSection = {
  textAlign: 'center' as const,
};

const button = {
  backgroundColor: '#18181b',
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: '600',
  padding: '12px 20px',
  textDecoration: 'none',
};

const hr = {
  borderColor: '#e4e4e7',
  margin: '28px 0 16px',
};

const footer = {
  color: '#71717a',
  fontSize: '12px',
  lineHeight: '18px',
  margin: '0',
};
