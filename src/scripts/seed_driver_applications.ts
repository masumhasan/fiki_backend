import { connectDB, disconnectDB } from "../config/db.js";
import { DriverApplication } from "../models/DriverApplication.js";

const SAMPLE_APPLICATIONS = [
  {
    applicationId: "APP-2026-963",
    fullName: "David Miller",
    firstName: "David",
    lastName: "Miller",
    email: "david.miller@fikitransit.com",
    phone: "(414) 555-9821",
    licenseNumber: "WI-CDL-998877",
    positionType: "AMBULATORY",

    streetAddress: "742 Evergreen Terrace",
    streetAddress2: "Apt 4B",
    city: "Milwaukee",
    state: "Wisconsin",
    zipCode: "53202",
    country: "United States",

    position: "Driver (Ambulatory & Wheel-Chair Passengers)",
    availableStartDate: "September 1, 2026",
    employmentStatus: "Full-Time",
    desiredSalary: "$48,000 / year",
    howDidYouHear: "Company Referral — Fleet Operations",

    authorizedInUS: "yes",
    felonyConviction: "no",
    felonyExplanation: "N/A — No felony conviction",

    highSchool: "Milwaukee Central High School",
    highSchoolGraduated: "yes",
    college: "University of Wisconsin-Milwaukee",
    collegeGraduated: "yes",
    degree: "Bachelor of Science in Logistics & Transportation",

    previousEmployer: "Midwest Medical Express",
    jobTitle: "Fleet Specialist Driver",
    startingSalary: "$40,000",
    endingSalary: "$46,000",
    responsibilities: "Safely transport ambulatory and wheelchair patients across Southeast Wisconsin",
    employmentFromDate: "Jun 2021",
    employmentToDate: "May 2025",
    reasonForLeaving: "Career growth and relocation to FIKI Transit fleet",

    referenceName: "Sarah Connor",
    referenceRelationship: "Former Fleet Supervisor — Midwest Medical",
    referencePhone: "(414) 555-1029",

    driverCategory: "CDL-A (Class A)",
    licenseExpirationDate: "2029-06-15",
    socialSecurityNumber: "999-00-1234",
    dateOfBirth: "05/14/1988",
    signature: "David Miller",
    status: "PENDING_REVIEW",
    backgroundStatus: "CLEARED",
  },
  {
    applicationId: "APP-2026-964",
    fullName: "Marcus Johnson",
    firstName: "Marcus",
    lastName: "Johnson",
    email: "marcus.johnson@gmail.com",
    phone: "(305) 847-2291",
    licenseNumber: "CDL-A F3847291",
    positionType: "AMBULATORY",

    streetAddress: "1842 NW 17th Avenue",
    city: "Miami",
    state: "Florida",
    zipCode: "33125",
    country: "United States",

    position: "Driver (Ambulatory)",
    availableStartDate: "August 15, 2026",
    employmentStatus: "Full time",
    desiredSalary: "$42,000 / year",
    howDidYouHear: "LinkedIn job posting",

    authorizedInUS: "yes",
    felonyConviction: "no",
    felonyExplanation: "N/A — No felony conviction",

    highSchool: "Miami Senior High School",
    highSchoolGraduated: "yes",
    college: "Miami Dade College",
    collegeGraduated: "yes",
    degree: "Associate of Applied Science — Transportation",

    previousEmployer: "Miami-Dade Transit",
    jobTitle: "Bus operator",
    startingSalary: "$36,000",
    endingSalary: "$44,000",
    responsibilities: "Operating transit buses and maintaining passenger safety logs",
    employmentFromDate: "Mar 2018",
    employmentToDate: "Nov 2022",
    reasonForLeaving: "Seeking new opportunities in medical transport",

    referenceName: "Robert A. Diaz",
    referenceRelationship: "Former supervisor — Miami-Dade Transit",
    referencePhone: "(305) 741-3392",

    driverCategory: "CDL-A (Class A)",
    licenseExpirationDate: "2028-02-14",
    socialSecurityNumber: "888-00-7821",
    dateOfBirth: "03/14/1987",
    signature: "Marcus Johnson",
    status: "PENDING_REVIEW",
    backgroundStatus: "CLEARED",
  },
];

async function seedDriverApplications() {
  console.log("🌱 Seeding Driver Applications with complete real data...");
  await connectDB();

  for (const app of SAMPLE_APPLICATIONS) {
    const existing = await DriverApplication.findOne({ applicationId: app.applicationId });
    if (existing) {
      await DriverApplication.updateOne({ applicationId: app.applicationId }, { $set: app });
      console.log(`🔄 Updated application ${app.applicationId} (${app.fullName})`);
    } else {
      await DriverApplication.create(app);
      console.log(`✅ Created application ${app.applicationId} (${app.fullName})`);
    }
  }

  console.log("🎉 Driver Applications seeded successfully!");
  await disconnectDB();
  process.exit(0);
}

seedDriverApplications().catch((err) => {
  console.error("❌ Failed to seed driver applications:", err);
  process.exit(1);
});
