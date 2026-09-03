# Migration Report: Base64 to S3 Upload Refactoring

**Date:** September 4, 2026
**Target Repositories:** `fiki_backend`, `fiki_landing`, `fiki_admin`, `fiki_driver`

## Overview
This report documents the architectural changes and data migration performed to stop storing large base64 image strings directly in the MongoDB database. 

Previously, signatures and vehicle photos submitted from frontend applications were stored directly in the MongoDB collections as `data:image/jpeg;base64,...` strings. This bloated the database size and increased API response times. 

The system has now been refactored to intercept these base64 strings on the frontend, automatically upload them to the AWS S3 bucket via the backend upload endpoints (`/upload/image` and `/upload/public-image`), and save only the resulting S3 URLs into the database.

## 1. Database Migration (Backend)
A one-time migration script was created and executed to backfill existing documents.

**Script Location:** `scripts/migrate_base64_to_s3.ts`
**Execution Command added:** `npm run migrate-base64`

### Collections Migrated:
* **Users (`avatarUrl`)**: Scanned and uploaded passenger and driver base64 avatars to the `passenger-avatars` S3 category.
* **Trips (`signature`, `receiverSignature`, `passengerAvatarUrl`)**: Migrated all trip-related signatures and avatars to S3.
* **DriverShifts (`startPhotoUrl`, `endPhotoUrl`, `startPhotoUrls`, `endPhotoUrls`)**: Scanned and uploaded any existing base64 odometer and vehicle condition photos to the `shift-odometers` and `vehicle-photos` S3 categories.

## 2. Frontend Implementations

A reusable upload utility (`lib/uploadBase64.ts`) was added to each frontend repository to handle the base64-to-S3 process cleanly.

### `fiki_landing`
* **Request Ride Form:** Intercepts `data.signature` before submitting a new public ride request.
* **Job Application Form:** Intercepts driver applicant signatures before submitting the job application.

### `fiki_admin`
* **Manual Ride Request Form:** Intercepts the dispatcher's base64 signature in `manual-ride-requests-page.tsx` before dispatching the payload to the backend.

### `fiki_driver`
* **Hand-to-Hand Signature Modal:** Updated `RideDetailsOverview.tsx` to safely upload the `receiverSignature` before confirming trip completion, utilizing the driver's authentication token.

## Future Recommendations
* Any newly added forms that capture signatures or images must utilize the `uploadBase64Image` utility *before* passing payloads to the backend API.
* The `migrate_base64_to_s3.ts` script can be safely deleted or kept in the `scripts/` folder for historical reference.
