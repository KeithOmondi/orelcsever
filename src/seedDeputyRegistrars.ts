// src/seedDeputyRegistrars.ts
//
// Run with: npx tsx src/seedDeputyRegistrars.ts

import { query, pool } from './config/db';
import { Role } from './types/roles';

interface RawRegistrar {
  name: string;
  station: string;
  pjNumber: string | null;
  phone: string | null;
  email: string | null;
}

interface SeedRow extends RawRegistrar {
  designation: string;
  role: Role;
}

// RM = Registrar, SRM = Senior Registrar, DR = Deputy Registrar,
// ADR = Assistant Deputy Registrar, PM = Principal Magistrate,
// SPM = Senior Principal Magistrate
// NOTE: this is a DISPLAY label only — it has no bearing on access control.
// Access control is entirely driven by `role` ('admin' | 'dr'), per types/roles.ts.
const DESIGNATION_MAP: Record<string, string> = {
  RM: 'Registrar',
  SRM: 'Senior Registrar',
  DR: 'Deputy Registrar',
  ADR: 'Assistant Deputy Registrar',
  PM: 'Principal Magistrate',
  SPM: 'Senior Principal Magistrate',
};

const getDesignation = (code: string): string => DESIGNATION_MAP[code] ?? 'Registrar';

// One seed admin so /register (adminOnly) is reachable at all.
// ⚠️ CHANGE these before running against a real environment.
const ADMIN_SEED: SeedRow = {
  name: 'System Administrator',
  station: 'Headquarters',
  designation: 'System Administrator',
  role: 'admin',
  pjNumber: 'PJ-ADMIN-001',
  phone: null,
  email: 'admin@court.go.ke',
};

const registrarsData: RawRegistrar[] = [
  { name: 'Lynn Michuki', station: 'Bomet', pjNumber: '82197', phone: '0711239121', email: 'mbeti.michuki@court.go.ke' },
  { name: 'Tina Madowo', station: 'Bungoma', pjNumber: '80248', phone: '0726480773', email: 'tina.madowo@court.go.ke' },
  { name: 'Kassim Akida', station: 'Busia', pjNumber: '80645', phone: '0723172234', email: 'kassim.akida@court.go.ke' },
  { name: 'Wachira Tracy Wanjiku', station: 'Chuka', pjNumber: '82185', phone: '0725997944', email: 'tracy.wachira@court.go.ke' },
  { name: 'Daniel Sitati Sifuma', station: 'Eldoret', pjNumber: '80334', phone: '0728425589', email: 'daniel.sitati@court.go.ke' },
  { name: 'Mercy N. Kinyua', station: 'Embu', pjNumber: '82184', phone: '0710359441', email: 'mercy.kinyua@court.go.ke' },
  { name: 'Beja Nduke Beja', station: 'Eldama Ravine', pjNumber: '69232', phone: '0712872308', email: 'beja.nduke@court.go.ke' },
  { name: 'Rachael Njoki Nganga', station: 'Garissa', pjNumber: '80335', phone: '0725609193', email: 'rachel.njoki@court.go.ke' },
  { name: 'Oscar Kinyua Wakina', station: 'Garsen', pjNumber: '80315', phone: '0711315836', email: 'oscar.wakina@court.go.ke' },
  { name: 'Christine Kemuma Auka', station: 'Homabay', pjNumber: '80345', phone: '0711616691', email: 'christine.auka@court.go.ke' },
  { name: 'Beja Nduke Beja', station: 'Kabarnet', pjNumber: '69232', phone: '0712872308', email: 'beja.nduke@court.go.ke' }, // duplicate pjNumber — excluded, see buildSeedRows
  { name: 'Betsy Chelangat', station: 'Iten', pjNumber: '47523', phone: '0712591323', email: 'Betsy.chelangat@court.go.ke' },
  { name: 'Maureen Atieno Odhiambo', station: 'Isiolo', pjNumber: '80227', phone: '0722173277', email: 'maureen.odhiambo@court.go.ke' },
  { name: 'Naomi Wangui', station: 'Kajiado', pjNumber: '80616', phone: '0708396204', email: 'naomi.wangui@court.go.ke' },
  { name: "Viennah Ong'oli Amboko", station: 'Kakamega', pjNumber: '80250', phone: '0723495064', email: 'viennah.amboko@court.go.ke' },
  { name: 'Nelly Kenei', station: 'Kapenguria', pjNumber: '80244', phone: '0733611354', email: 'nelly.kenei@court.go.ke' },
  { name: 'Osotsi Lawrence', station: 'Kapsabet', pjNumber: '68309', phone: '0706535878', email: 'lawrence.omutuku@court.go.ke' },
  { name: 'Judy Linda Kananu Muthee', station: 'Kericho', pjNumber: '82168', phone: '0711833885', email: 'linda.muthee@court.go.ke' },
  { name: 'Lisper Gakii Nyaga', station: 'Kerugoya', pjNumber: '80613', phone: '0711667249', email: 'lisper.nyaga@court.go.ke' },
  { name: 'Rawlings Liluma Musiega', station: 'Kiambu', pjNumber: '80344', phone: '0711284007', email: 'rawlings.liluma@court.go.ke' },
  { name: 'Barbara Alice Akinyi', station: 'Kibera', pjNumber: '80480', phone: '0787372997', email: 'akinyi.barbara@court.go.ke' },
  { name: 'Cyprian Wafula Waswa', station: 'Kilgoris', pjNumber: '80336', phone: '0718960327', email: 'cyprian.waswa@court.go.ke' },
  { name: 'Winnie Keter Chepkirui', station: 'Kisii', pjNumber: '82205', phone: '0717049877', email: 'winnie.keter@court.go.ke' },
  { name: 'Valarie Emelda Adhiambo', station: 'Kisumu', pjNumber: '80362', phone: '0723047016', email: 'valarie.adhiambo@court.go.ke' },
  { name: 'Magwi Wilkister Ghati', station: 'Kitale', pjNumber: '82188', phone: '0703680162', email: 'wilkister.magwi@court.go.ke' },
  { name: 'Elizabeth Wairimu Karani', station: 'Kitui', pjNumber: '80246', phone: '0723626787', email: 'elizabeth.karani@court.go.ke' },
  { name: 'Joy Babone Mutimba', station: 'Kwale', pjNumber: '80631', phone: '0720928626', email: 'joy.mutimba@court.go.ke' },
  { name: "Flavian Mung'ahu Mulama", station: 'Lamu', pjNumber: '82208', phone: '0715552456', email: 'flavian.mulama@court.go.ke' },
  { name: 'Michael Loktari Lokitam', station: 'Lodwar', pjNumber: '83812', phone: '0721601660', email: 'michael.lokitam@court.go.ke' },
  { name: 'Dorcas Endoo', station: 'Machakos', pjNumber: '80633', phone: '0719340535', email: 'denchep@gmail.com' },
  { name: 'Cornel Ochieng Omondi', station: 'Mandera', pjNumber: '82177', phone: '0727070836', email: 'cornel.omondi@court.go.ke' },
  { name: 'Stephany Wambui Githogori', station: 'Makadara', pjNumber: '80366', phone: '0723304068', email: 'stephany.wambui@court.go.ke' },
  { name: 'Fransisca Ngetich', station: 'Makueni', pjNumber: '82219', phone: '0723139232', email: 'fransisca.chepkoech@court.go.ke' },
  { name: 'Susan Ndunge Mutava', station: 'Malindi', pjNumber: '80660', phone: '0735561485', email: 'susan.mutava@court.go.ke' },
  { name: "Gatambia S. Ndung'u", station: 'Maralal', pjNumber: null, phone: '0733146265', email: 'gatambia.ndungu@court.go.ke' }, // missing pjNumber — excluded
  { name: 'Edward Meshack Otieno', station: 'Marsabit', pjNumber: '80615', phone: '0718760218', email: 'edward.oboge@court.go.ke' },
  { name: 'Habrovinah Nyamweya', station: 'Meru', pjNumber: '82162', phone: '0705899858', email: 'habrovinah.nyamweya@court.go.ke' },
  { name: 'Chelagat Patricia Koechi', station: 'Migori', pjNumber: '82187', phone: '0704940904', email: 'patricia.koech@court.go.ke' },
  { name: 'Noelle Mutheu', station: 'Milimani - Commercial & Tax', pjNumber: '80231', phone: '0721767145', email: 'noelle.kyanya@court.go.ke' },
  { name: "Velnah Mochache Mong'ina", station: 'Milimani - Commercial & Tax', pjNumber: '80299', phone: '0729492191', email: 'velnah.mochache@court.go.ke' },
  { name: 'Stella N Sagwe', station: 'Commercial & Tax Division', pjNumber: '44575', phone: '0721648707', email: 'stellah.nyanchama@court.go.ke' },
  { name: 'Mercy Lamwenya', station: 'Commercial & Tax Division', pjNumber: '81771', phone: '0713493499', email: 'mercy.lamwenya@court.go.ke' },
  { name: 'Virginia Kavata Maingi', station: 'Milimani - Family Division', pjNumber: '45369', phone: '0724677038', email: 'virginia.maingi@court.go.ke' },
  { name: 'Dorothy Aswani', station: 'Milimani - Family Division', pjNumber: '80688', phone: '0721610779', email: 'dorothy.aswani@court.go.ke' },
  { name: 'Janet Chepkorir Tolei', station: 'Milimani - Family Division', pjNumber: '44711', phone: '0721162077', email: 'Janeth.tolei@court.go.ke' },
  { name: 'Rosemary Onkoba', station: 'Milimani - CHR Division', pjNumber: '80338', phone: '0723064854', email: 'Rosemary.onkoba@court.go.ke' },
  { name: 'Isabelle Kimani', station: 'Milimani - Judicial Review', pjNumber: '81492', phone: '0722809464', email: 'isabelle.kimani@court.go.ke' },
  { name: 'Justine Amoro Asiago', station: 'Milimani - Civil Appellate', pjNumber: '80663', phone: '0715081685', email: 'justine.amoro@court.go.ke' },
  { name: 'Caroline Auma Okumu', station: 'Milimani - Civil Appellate', pjNumber: '80628', phone: '0706343503', email: 'caroline.okumu@court.go.ke' },
  { name: 'Louisa Chembeni', station: 'Milimani - Civil Division', pjNumber: '80255', phone: '0710978244', email: 'louisa.chembeni@court.go.ke' },
  { name: 'Silvia Kerubo Motari', station: 'Milimani - Tribunals Appeals Division', pjNumber: '80624', phone: '0789565151', email: 'silviakerubo@gmail.com' },
  { name: 'Caroline Muthoni Njue', station: 'Milimani - Civil Division', pjNumber: '81787', phone: '0729886436', email: 'caroline.njue@court.go.ke' },
  { name: 'Evelyn Gaithuma', station: 'Milimani - ACEC', pjNumber: '80636', phone: '0724131118', email: 'evelyn.gaithuma@court.go.ke' },
  { name: 'Nancy Wambulwa', station: 'Anti-Corruption Division', pjNumber: '69868', phone: '0701247199', email: 'nancy.wambulwa@court.go.ke' },
  { name: 'Adelaide Namabihi Sisenda', station: 'Milimani - Criminal', pjNumber: '80247', phone: '0721262726', email: 'adelaide.sisenda@court.go.ke' },
  { name: 'Mercy Njeri Watatua', station: 'Criminal Division', pjNumber: '46438', phone: '0712657606', email: 'mercy.watatua@gmail.com' },
  { name: 'Maureen Shimenga', station: 'Office of Principal Judge', pjNumber: '57641', phone: '0718124742', email: 'maureen.shimenga@court.go.ke' },
  { name: 'Jane Ocharo', station: 'Milimani - ORHC', pjNumber: '58845', phone: '0720365533', email: 'ocharo.jane@gmail.com' },
  { name: 'Linda Mumassabba', station: 'Milimani - ORHC', pjNumber: '57316', phone: '0720300235', email: 'linda.mumassabba@court.go.ke' },
  { name: 'Jeffrey Sagirai', station: 'Milimani - ORHC', pjNumber: '41658', phone: '0710324175', email: 'jeffrey.sagirai@court.go.ke' },
  { name: 'Edith Malizu Gwalimba', station: 'Milimani - ORHC', pjNumber: '46446', phone: '0721903935', email: 'edith.malizu@court.go.ke' },
  { name: 'Opiyo Green Odera', station: 'Mombasa', pjNumber: '82170', phone: '0707421052', email: 'green.opiyo@court.go.ke' },
  { name: 'Rodgers Asitiba', station: 'Mombasa', pjNumber: null, phone: '0723310189', email: 'rodgers.atenya@court.go.ke' }, // missing pjNumber — excluded
  { name: 'Grace Waithera', station: 'Muranga', pjNumber: null, phone: '0710136868', email: 'grace.kinuthia@court.go.ke' }, // missing pjNumber — excluded
  { name: 'Elizabeth Kemei', station: 'Naivasha', pjNumber: '80612', phone: '0728725366', email: 'elizabeth.kemei@court.go.ke' },
  { name: 'Emmanuel Soita Siundu', station: 'Nakuru', pjNumber: '80226', phone: '0722886058', email: 'emmanuel.soita@court.go.ke' },
  { name: 'Lynn Atamba Mwera', station: 'Nyandarua', pjNumber: '80620', phone: '0704312250', email: 'atamba.mwera@court.go.ke' },
  { name: 'Maureen M. Kimani', station: 'Nanyuki', pjNumber: '80370', phone: '0722360985', email: 'maureen.mumbi@court.go.ke' },
  { name: 'Mutuku Esther Mwikali', station: 'Narok', pjNumber: '82179', phone: '0717005053', email: 'esther.mwikali@court.go.ke' },
  { name: 'Mary Wanjiru Njuguna', station: 'Nyahururu', pjNumber: '80367', phone: '0724754356', email: 'mary.njuguna@court.go.ke' },
  { name: 'Jumar Beryl Achieng', station: 'Nyamira', pjNumber: '82167', phone: '0714207975', email: 'beryl.jumar@court.go.ke' },
  { name: 'Andrew Motari', station: 'Nyeri', pjNumber: '47565', phone: '0729829453', email: 'andrew.omwenga@court.go.ke' },
  { name: 'Mkala Jacob Punga', station: 'Siaya', pjNumber: '82166', phone: '0716760052', email: 'jacob.mkala@court.go.ke' },
  { name: 'Imaana Fredrick Koome', station: 'Thika', pjNumber: '80329', phone: '0720433458', email: 'fredrick.imaana@court.go.ke' },
  { name: 'Beryl A. Omollo', station: 'Vihiga', pjNumber: '80230', phone: '0726589207', email: 'omolloberyl@gmail.com' },
  { name: 'Faith Apindi Malimu', station: 'Voi', pjNumber: '83868', phone: '0725341810', email: 'faith.malimu@court.go.ke' },
  { name: 'Baraka Xavier Francis', station: 'Wajir', pjNumber: '82209', phone: '0723172092', email: 'francis.xavier@court.go.ke' },
];

// Designation codes, same order as registrarsData above. Display-only.
const designationCodes = [
  'RM', 'SRM', 'SRM', 'RM', 'SRM', 'RM', 'DR', 'SRM', 'SRM', 'SRM',
  'DR', 'DR', 'SRM', 'SRM', 'SRM', 'SRM', 'DR', 'RM', 'SRM', 'SRM',
  'SRM', 'SRM', 'RM', 'SRM', 'RM', 'RM', 'SRM', 'RM', 'RM', 'SRM',
  'RM', 'SRM', 'RM', 'SRM', 'RM', 'SRM', 'RM', 'RM', 'SRM', 'SRM',
  'DR', 'DR', 'ADR', 'SRM', 'DR', 'SRM', 'DR', 'SRM', 'SRM', 'SRM',
  'SRM', 'DR', 'SRM', 'DR', 'SRM', 'DR', 'PM', 'SPM', 'PM', 'DR',
  'DR', 'SRM', 'RM', 'SRM', 'SRM', 'SRM', 'SRM', 'SRM', 'RM', 'SRM',
  'RM', 'DR', 'RM', 'SRM', 'SRM', 'RM', 'RM',
];

const buildSeedRows = (): { rows: SeedRow[]; skipped: { row: RawRegistrar; reason: string }[] } => {
  const rows: SeedRow[] = [];
  const skipped: { row: RawRegistrar; reason: string }[] = [];
  const seenPjNumbers = new Set<string>();
  const seenEmails = new Set<string>();

  registrarsData.forEach((raw, index) => {
    if (!raw.pjNumber) {
      skipped.push({ row: raw, reason: 'missing pjNumber' });
      return;
    }
    if (!raw.email) {
      skipped.push({ row: raw, reason: 'missing email' });
      return;
    }
    if (seenPjNumbers.has(raw.pjNumber)) {
      skipped.push({ row: raw, reason: `duplicate pjNumber ${raw.pjNumber} (already queued from an earlier row)` });
      return;
    }
    if (seenEmails.has(raw.email.toLowerCase())) {
      skipped.push({ row: raw, reason: `duplicate email ${raw.email} (already queued from an earlier row)` });
      return;
    }

    seenPjNumbers.add(raw.pjNumber);
    seenEmails.add(raw.email.toLowerCase());

    const code = designationCodes[index] ?? 'RM';
    rows.push({
      ...raw,
      designation: getDesignation(code),
      role: 'dr', // everyone in this seed list is a deputy registrar / registrar-tier user — access-control-wise, all 'dr'
    });
  });

  return { rows, skipped };
};

const insertRow = async (row: SeedRow): Promise<'inserted' | 'skipped'> => {
  const existing = await query('SELECT id FROM users WHERE pj_number = $1 OR email = $2', [
    row.pjNumber,
    row.email,
  ]);

  if ((existing.rowCount ?? 0) > 0) {
    return 'skipped';
  }

  await query(
    `INSERT INTO users (pj_number, full_name, email, phone, station, designation, role, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     RETURNING id`,
    [row.pjNumber, row.name, row.email, row.phone, row.station, row.designation, row.role, true]
  );

  return 'inserted';
};

const seedRegistrars = async (): Promise<void> => {
  const { rows, skipped } = buildSeedRows();
  const allRows: SeedRow[] = [ADMIN_SEED, ...rows];

  console.log('🌱 Seeding users...');
  console.log(`📋 ${allRows.length} rows queued for insert (${skipped.length} rows excluded before insert).`);

  if (skipped.length > 0) {
    console.log('\n⏭️  Excluded before insert:');
    skipped.forEach(({ row, reason }) => console.log(`   - ${row.name} (${row.station}): ${reason}`));
  }

  let inserted = 0;
  let alreadyExisted = 0;
  let failed = 0;

  for (const row of allRows) {
    try {
      const result = await insertRow(row);
      if (result === 'inserted') {
        inserted++;
        console.log(`✅ Inserted: ${row.name} (${row.pjNumber}) - ${row.station}`);
      } else {
        alreadyExisted++;
        console.log(`⏭️  Already exists: ${row.name} (${row.pjNumber})`);
      }
    } catch (error) {
      failed++;
      console.error(`❌ Failed to insert ${row.name} (${row.pjNumber}):`, error);
    }
  }

  console.log('\n📊 Summary:');
  console.log(`   Inserted:        ${inserted}`);
  console.log(`   Already existed: ${alreadyExisted}`);
  console.log(`   Failed:          ${failed}`);
  console.log(`   Excluded upfront: ${skipped.length}`);
};

const run = async (): Promise<void> => {
  try {
    await seedRegistrars();
  } catch (error) {
    console.error('❌ Seeder failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

run();

export { seedRegistrars, buildSeedRows };