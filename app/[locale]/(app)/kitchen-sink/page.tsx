'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Award, Mail, Plus, Sparkles } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  DataTable,
  type ColumnDef,
  DateRangePicker,
  type DateRangeValue,
  Drawer,
  EmptyState,
  FieldHint,
  Input,
  Label,
  Modal,
  MoneyInput,
  PageHeader,
  PercentInput,
  PhoneInput,
  RadioGroup,
  SearchBar,
  SectionSwitcher,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  TimeRangeSelect,
  Toggle,
  useToast,
} from '@/components/ui';

type Row = { id: string; name: string; service: string; price: number };

const sampleRows: Row[] = [
  { id: '1', name: 'Jules Lethor', service: 'Haircut + Beard', price: 43.49 },
  { id: '2', name: 'Drew Paris', service: 'Haircut + Beard', price: 43.49 },
  { id: '3', name: 'tjo tjo', service: 'Haircut', price: 34.79 },
  { id: '4', name: 'Glenn Nz', service: 'Haircut + Beard', price: 43.49 },
];

const columns: ReadonlyArray<ColumnDef<Row>> = [
  { id: 'name', header: 'Client', cell: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { id: 'service', header: 'Service', cell: (r) => r.service },
  {
    id: 'price',
    header: 'Price',
    cell: (r) => `$${r.price.toFixed(2)}`,
    sortable: true,
    sortValue: (r) => r.price,
    align: 'right',
  },
];

export default function KitchenSinkPage() {
  const t = useTranslations('pages.kitchenSink');
  const sections = useTranslations('pages.kitchenSink.sections');

  const [toggleOn, setToggleOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState<'transaction' | 'value'>('transaction');
  const [view, setView] = useState<'products' | 'brands' | 'categories'>('products');
  const [tab, setTab] = useState<'confirmed' | 'staff' | 'deleted'>('confirmed');
  const [reminder, setReminder] = useState(1440); // 24h
  const [dateRange, setDateRange] = useState<DateRangeValue>({
    start: '2026-05-16',
    end: '2026-05-22',
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { show } = useToast();

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        center={<SearchBar placeholder="Search components…" />}
        actions={
          <Button variant="primary" size="sm">
            <Plus className="h-4 w-4" /> Add something
          </Button>
        }
        switcher={
          <SectionSwitcher
            trigger="VIEW"
            value={view}
            onChange={setView}
            options={[
              { value: 'products', label: 'Products' },
              { value: 'brands', label: 'Brands' },
              { value: 'categories', label: 'Categories', badge: 'new' },
            ]}
          />
        }
      />

      <div className="space-y-8 p-6">
        {/* Buttons */}
        <Section title={sections('buttons')}>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
            <Button variant="secondary">
              <Mail className="h-4 w-4" /> With icon
            </Button>
          </div>
        </Section>

        {/* Badges */}
        <Section title={sections('badges')}>
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="success">Verified</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="danger">Danger</Badge>
            <Badge variant="info">Company</Badge>
            <Badge variant="new">New</Badge>
          </div>
        </Section>

        {/* Inputs */}
        <Section title={sections('inputs')}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Shop name" required>
              <Input placeholder="Axum barbershop" />
            </Field>
            <Field label="Email">
              <Input type="email" placeholder="hello@example.com" />
            </Field>
            <Field label="Service price">
              <MoneyInput defaultValue={34.79} />
            </Field>
            <Field label="Commission rate">
              <PercentInput defaultValue={55} />
            </Field>
            <Field label="Phone">
              <PhoneInput placeholder="514 452 3057" />
            </Field>
            <Field label="Default language">
              <Select defaultValue="en">
                <option value="fr">Français</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label="Date range" className="md:col-span-2">
              <DateRangePicker value={dateRange} onChange={setDateRange} />
            </Field>
            <Field label="1st client reminder">
              <TimeRangeSelect valueMinutes={reminder} onChange={setReminder} />
            </Field>
            <Field label="Description" className="md:col-span-2">
              <Textarea placeholder="Shop description…" />
              <FieldHint>Shown publicly on the booking page.</FieldHint>
            </Field>
          </div>
        </Section>

        {/* Controls */}
        <Section title={sections('controls')}>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Toggle
              </p>
              <Toggle checked={toggleOn} onChange={setToggleOn} label="Booking tip" />
              <Toggle checked={false} onChange={() => undefined} label="Disabled" disabled />
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Checkbox
              </p>
              <Checkbox
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                label="Add to price"
              />
              <Checkbox checked={false} disabled label="Disabled" readOnly />
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Radio group
              </p>
              <RadioGroup
                name="loyalty-type"
                value={radio}
                onChange={setRadio}
                options={[
                  { value: 'transaction', label: 'Transaction based' },
                  { value: 'value', label: 'Value based' },
                ]}
              />
            </div>
          </div>
        </Section>

        {/* Overlays */}
        <Section title={sections('overlays')}>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
              Open Modal
            </Button>
            <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
              Open Drawer
            </Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Confirm dialog
            </Button>
          </div>
          <div className="mt-6">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'confirmed', label: 'Confirmed', count: 4 },
                { value: 'staff', label: 'Staff', count: 0 },
                { value: 'deleted', label: 'Deleted', count: 0 },
              ]}
            />
            <p className="mt-3 text-sm text-text-secondary">Selected tab: {tab}</p>
          </div>

          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Add appointment"
            description="Pick a service, a barber and a time slot."
            footer={
              <>
                <Button variant="secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setModalOpen(false)}>Save</Button>
              </>
            }
          >
            <p className="text-sm text-text-secondary">Modal body — real form lives in Phase 5.</p>
          </Modal>

          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            title="Appointment details"
          >
            <p className="text-sm text-text-secondary">
              Drawer is used by the calendar to show appointment details on row click.
            </p>
          </Drawer>

          <ConfirmDialog
            open={confirmOpen}
            title="Delete this discount?"
            description="This action cannot be undone."
            destructive
            confirmLabel="Delete"
            onConfirm={() => {
              setConfirmOpen(false);
              show({ variant: 'success', title: 'Discount deleted' });
            }}
            onCancel={() => setConfirmOpen(false)}
          />
        </Section>

        {/* Navigation */}
        <Section title={sections('navigation')}>
          <Card>
            <CardHeader>
              <CardTitle>Page header preview</CardTitle>
              <Badge variant="accent">Phase 1</Badge>
            </CardHeader>
            <CardBody className="space-y-3 text-sm text-text-secondary">
              <p>
                The sidebar on the left is the real component — collapse it with the chevron in the
                top-left corner. Active item gets an accent bar and accent text.
              </p>
              <p>
                The page header at the top of every shell page exposes slots for a title, a centered
                search bar, action buttons, and a SectionSwitcher (the &quot;VIEW&quot; dropdown
                above).
              </p>
            </CardBody>
          </Card>
        </Section>

        {/* Data */}
        <Section title={sections('data')}>
          <div className="space-y-4">
            <DataTable
              columns={columns}
              data={sampleRows}
              getRowKey={(r) => r.id}
              reorderable
              onRowClick={(r) => show({ variant: 'info', title: `Clicked ${r.name}` })}
              pagination={{
                page: 1,
                pageSize: 4,
                total: 4,
                onPageChange: () => undefined,
              }}
            />

            <EmptyState
              icon={<Sparkles className="h-8 w-8" />}
              title="Nothing here yet"
              description="Empty states use a dashed border and a centered icon/title/description stack."
              action={<Button size="sm">Add the first one</Button>}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          </div>
        </Section>

        {/* Feedback */}
        <Section title={sections('feedback')}>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => show({ variant: 'success', title: 'Saved' })}
            >
              <Award className="h-4 w-4" /> Success toast
            </Button>
            <Button
              variant="secondary"
              onClick={() => show({ variant: 'info', title: 'Heads up', description: 'Just FYI.' })}
            >
              Info toast
            </Button>
            <Button
              variant="secondary"
              onClick={() => show({ variant: 'warning', title: 'Careful' })}
            >
              Warning toast
            </Button>
            <Button
              variant="secondary"
              onClick={() => show({ variant: 'danger', title: 'Something failed' })}
            >
              Danger toast
            </Button>
          </div>
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
      <div className="rounded border border-border bg-bg-surface p-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}
