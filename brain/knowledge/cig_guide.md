---
title: SAP Ariba Cloud Integration Gateway: Guia de Configuração e Uso
tags: [SAP Ariba, Cloud Integration Gateway, Ariba Network, EDI, cXML, Integração, Fornecedor, Comprador, ERP, Documentos]
source: CIG_Guide.txt
added: 2026-05-24
---

## Resumo
O SAP Ariba Cloud Integration Gateway (CIG) é uma ferramenta de autoatendimento para fornecedores configurarem e integrarem-se à Ariba Network, facilitando transações com compradores. Suporta múltiplos formatos de documentos (cXML, EDIFACT, X12, etc.), oferece validação de erros, e requer uma conta ativa na Ariba Network e configuração de relacionamento. O acesso e a configuração são feitos via Ariba Network, com opções de roteamento e permissões de usuário. O CIG é hospedado em data center SAP na Alemanha, com certificações de segurança.

## Conteúdo
SAP Ariba Cloud Integration Gateway How to Guide
Ariba Network — SAP Official Documentation (2018)

=== ABOUT THE SAP ARIBA CLOUD INTEGRATION GATEWAY ===

The SAP Ariba Cloud Integration Gateway is a self-service gateway that allows suppliers to configure and integrate to Ariba Network and transact with buyers seamlessly.

Using the SAP Ariba Cloud Integration Gateway, you can:
- Configure your integration between Ariba Network and your ERP application to manage one or more buyer-supplier trading relationships.
- Specify the mapping configuration
- Validate and self test transaction documents.
- Monitor and track the integration lifecycle overall.

=== DOCUMENT TYPES SUPPORTED ===

Supported document formats: cXML, UN-EDIFACT D96A, GS1 GUSI, ASC-X12 v4010, OAGIS v9.2, PIDX, EANCOM 97, EANCOM 2002

Document Type | cXML | UN-EDIFACT | ASC-X12
Purchase Order | OrderRequest / CopyRequest | ORDERS | 850
Sales Orders | SalesOrderRequest | — | —
Purchase Order Change Request | OrderRequest / CopyRequest | ORDCHG | 860
Purchase Order Response | ConfirmationRequest | ORDRSP | 855
Advanced Shipment Notice | ShipNoticeRequest / CopyRequest | DESADV | 856
Invoice | InvoiceDetail / InvoiceDetailRequest | INVOIC | 810
Invoice Response | StatusUpdateRequest | — | —
Technical Acknowledgment | StatusUpdateRequest | CONTRL | 997
Goods Request (Inbound) | ReceiptRequest | RECADV | 861
Forecast Visibility | ProductActivityMessage | — | 830
Forecast Commit | ProductReplenishmentMessage | — | 830
Inventory | ProductReplenishmentMessage | INVRPT | 846
Transport Request | TransportRequest | IFTMIN | 204
Transport Confirmation | TransportConfirmation | IFTSTA | 214
Quality Notification (Inbound/Outbound) | — | — | 842
Scheduling Agreement Release | OrderRequest | DELFOR | —
Payment Remittance | PaymentRemittance | REMADV | 820

File size limit: 100 MB per EDI envelope; individual transactions after splitting must be less than 40 MB.

=== ERROR HANDLING ===

Error Validation for Fields:
- Missing required fields are highlighted in red when saving/activating
- URL fields must use HTTPS://
- Gateway validates all field formats

=== GETTING STARTED — PREREQUISITES ===

To connect to the Cloud Integration Gateway, you must have:
1. An active supplier account on Ariba Network
2. A valid trading buyer-supplier relationship on Ariba Network
3. Configure Ariba Network account to send/receive transaction documents from CIG
4. Configure Ariba Network account for EDI documents
5. Configure system to support IETF AS2 documents
6. Configure digital certificates for HTTPS or AS2 transport

=== ACCESSING THE SAP ARIBA CLOUD INTEGRATION GATEWAY ===

Access from Ariba Network: Company Account Settings → Electronic Order Routing → Configure Ariba Cloud Integration Gateway (non-native integration) → Go to the Ariba Cloud Integration Gateway

Login procedure:
1. Log in to Ariba Network account
2. Click Company Account Settings (upper right)
3. Select Electronic Order Routing
4. Click Configure Ariba Cloud Integration Gateway (non-native integration)
5. Click Go to the Ariba Cloud Integration Gateway
6. Enter ERP system information (first time only)
7. Click Save

Enable CIG on Ariba Network:
1. Log in to Ariba Network
2. Company Account Settings → Electronic Order Routing
3. Configure Cloud Integration Gateway (non-native integration)
4. Click Enable the Ariba Cloud Integration Gateway
5. Save → Close
6. On Electronic Order Routing page, choose Cloud Integration Gateway routing method from dropdown
7. Specify routing method for each document type (non-cXML format)
8. Specify configuration values in Options column
9. Save and Close

=== CONFIGURING ROUTING METHODS FOR NON-cXML TRANSACTION DOCUMENTS ===

1. Log into Ariba Network
2. Company Account Settings → Electronic Order Routing
3. Choose Cloud Integration Gateway routing method from dropdown in Routing Method column
4. Specify corresponding configuration values in Options column
5. Save and Close

=== USER PERMISSIONS ===

Supplier administrators can assign predefined permissions:
- Ariba Cloud Integration Gateway Configuration: Create, modify, maintain projects
- Ariba Cloud Integration Gateway Access: View and search projects

Steps: Company Account Settings → Account Settings → Users → Create Role → assign permissions → Save → Create User

=== TRUSTED CERTIFICATE AUTHORITIES ===

Accepted CAs include: GeoTrust, Entrust, Symantec, VeriSign (multiple classes), thawte, TC TrustCenter, GoDaddy, DigiCert, Cybertrust, AddTrust/COMODO, GlobalSign, SwissSign, QuoVadis, Baltimore CyberTrust, Equifax, SAP Trust Community

=== DATA CENTER HOSTING ===

SAP Ariba Cloud Integration Gateway hosted in SAP Germany data center (St. Leon-Rot).
Certified under: ISO 27001, SOC 1/SSAE 16, SOC 2

Firewall: permit unbound traffic from IP range 155.56.128.1 to 155.56.255.254

=== CONFIGURING AN ARIBA CLOUD INTEGRATION PROJECT ===

Project workflow: Basic Information → Connection → Mappings → Cross Reference → Test → Deployment

When creating a project:
1. Configure connection to endpoint and Ariba Network
2. Configure data map for transaction documents to Ariba Network
3. Setup buyer and supplier profile information
4. Test project configuration and sign off to production

Note: Only secure communication channels supported (HTTPS). Non-SSL channels are not allowed.

=== ARIBA NETWORK CONNECTIONS ===

EDI Transport Types: HTTPS, AS2, RNIF, VAN

Connection configuration fields:
- Environment: TEST / PRODUCTION (or TEST/PRODUCTION combined)
- Document Format: UN-EDIFACT, ASC-X12, OAGIS, PIDX
- Document Type: ANY (all types) or specific type
- URL: HTTPS:// required
- Authentication Type: Basic (username/password) or Certificate

Basic Authentication: requires special user from Cloud Identity Service Registration
Password reset: https://aribaoperations.accounts.ondemand.com

Certificate Authentication: upload or reuse certificates; must match configured Ariba solution certificate

AS2 specific fields:
- Ariba AS2ID Test (read-only)
- Ariba AS2ID Production (read-only)
- Trading Partner AS2 ID
- Ariba VAN Interchange ID
- VAN AS2 ID
- MDN Type: synchronous or asynchronous
- MDN URL
- S/MIME Type: signed, encrypted, signedAndEncrypted, plain
- Digital Certificate Encryption Algorithm: RC2, TripleDES, AES-128, AES-192, AES-256
- Digital Certificate Signing Algorithm: SHA1, SHA2-224, SHA2-256, SHA2-384, SHA2-512, MD

Note: AS2 files sent with same filename every time — use MessageID within payload for unique identification.
Note: AS2 connections do not support compressed messages.

=== MAPPINGS FOR TRANSACTION DOCUMENTS ===

Mapping fields:
- Direction: receive (sent to you) or send (sent from you)
- Document Format: UN-EDIFACT, ASC-X12, OAGIS, PIDX, EANCOM 97, EANCOM 2002
- Document Format Version: D96A (EDIFACT), 004010 (ASC-X12), 0 (cXML), 9.2 (OAGIS), 1.6.1 (PIDX)
- Document Type: specific type code

Note: Mapping NOT required for projects with cXML document format.

=== BUYER AND SUPPLIER INFORMATION (CROSS REFERENCES) ===

Cross references route documents to correct trading partner via Ariba Network.

Fields:
- Trading Partner Ariba Network ID (auto-filled, read-only)
- Trading Partner EDI Qualifier (e.g. 01 = DUNS number)
- Trading Partner EDI Interchange ID (free text)
- Trading Partner EDI Group ID (free text)
- Customer Name (for multi-customer projects)
- Customer Ariba Network ID
- Ariba Qualifier ID (predefined, read-only)
- Ariba Interchange ID (auto-filled)
- Customer EDI Group ID (up to 14 characters)
- Trading Partner OAGIS ID / Customer OAGIS ID
- Trading Partner DUNS / Customer DUNS (for PIDX integration)
- Ariba VAN Interchange ID
- GSI EAN ID (for EANCOM integration)

Cross references are NOT required for cXML document format projects.
Cross references created in a project are available in all projects with same document format.

=== LIST OF VALID EDI QUALIFIERS ===

01 = Duns (Dun & Bradstreet)
02 = SCAC (Standard Carrier Alpha Code)
04 = IATA
08 