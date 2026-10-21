"use client";

import { useEffect, useState } from "react";

type DocumentType = "cnic_front" | "cnic_back" | "selfie" | "address_proof";

interface Document {
  type: DocumentType;
  label: string;
  description: string;
  file?: File;
  uploaded?: boolean;
}

export default function KYCPage() {
  const [kycStatus, setKycStatus] = useState("pending");
  const [documents, setDocuments] = useState<Document[]>([
    { type: "cnic_front", label: "CNIC Front", description: "Clear front side of your national ID" },
    { type: "cnic_back", label: "CNIC Back", description: "Clear back side of your national ID" },
    { type: "selfie", label: "Live Selfie", description: "Photo of yourself holding your CNIC" },
    { type: "address_proof", label: "Address Proof", description: "Utility bill or bank statement" },
  ]);

  useEffect(() => {
    // Fetch KYC status
    fetchKycStatus();
  }, []);

  const fetchKycStatus = async () => {
    try {
      const response = await fetch("/api/kyc/get-status");
      const data = await response.json();
      if (data.status) {
        setKycStatus(data.status);
      }
    } catch (error) {
      console.error("Failed to fetch KYC status", error);
    }
  };

  const handleFileSelect = (docType: DocumentType, file: File) => {
    setDocuments(docs =>
      docs.map(doc =>
        doc.type === docType ? { ...doc, file } : doc
      )
    );
  };

  const handleUpload = async (docType: DocumentType) => {
    const doc = documents.find(d => d.type === docType);
    if (!doc || !doc.file) return;

    try {
      const formData = new FormData();
      formData.append("document_type", docType);
      formData.append("file", doc.file);

      const response = await fetch("/api/kyc/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      setDocuments(docs =>
        docs.map(d =>
          d.type === docType ? { ...d, uploaded: true } : d
        )
      );

      // Check if all docs uploaded
      const allUploaded = documents.every(d => d.uploaded || d.type === docType);
      if (allUploaded) {
        fetchKycStatus();
      }
    } catch (error) {
      console.error("Upload error:", error);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-900 text-yellow-300",
      submitted: "bg-blue-900 text-blue-300",
      verified: "bg-green-900 text-green-300",
      rejected: "bg-red-900 text-red-300",
    };
    return colors[status] || "bg-slate-700 text-slate-300";
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold text-white mb-8">KYC Verification</h1>

      {/* Status Card */}
      <div className="glass rounded-lg p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm mb-2">Verification Status</p>
            <p className="text-2xl font-bold text-white">
              {kycStatus.charAt(0).toUpperCase() + kycStatus.slice(1)}
            </p>
          </div>
          <span className={`px-4 py-2 text-sm font-semibold rounded ${getStatusColor(kycStatus)}`}>
            {kycStatus === "pending" && "Complete documents"}
            {kycStatus === "submitted" && "Under review"}
            {kycStatus === "verified" && "Approved"}
            {kycStatus === "rejected" && "Resubmit"}
          </span>
        </div>
      </div>

      {/* Document Upload */}
      <div className="glass rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold text-white mb-6">Upload Documents</h2>
        <div className="space-y-6">
          {documents.map((doc) => (
            <div key={doc.type} className="border border-slate-700 rounded-lg p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-white font-semibold">{doc.label}</p>
                  <p className="text-slate-400 text-sm">{doc.description}</p>
                </div>
                {doc.uploaded && (
                  <span className="px-2 py-1 bg-green-900 text-green-300 text-xs rounded">✓ Uploaded</span>
                )}
              </div>

              <div className="flex gap-2">
                <label className="flex-1 relative cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleFileSelect(doc.type, e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                  <div className="w-full px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-white text-center text-sm transition-colors">
                    {doc.file ? doc.file.name : "Choose File"}
                  </div>
                </label>

                <button
                  onClick={() => handleUpload(doc.type)}
                  disabled={!doc.file}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white rounded font-medium transition-colors disabled:cursor-not-allowed"
                >
                  {doc.uploaded ? "Replace" : "Upload"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Guidelines */}
      <div className="glass rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Document Guidelines</h2>
        <ul className="space-y-3 text-slate-400 text-sm">
          <li>• All documents must be clear and legible</li>
          <li>• No blurry or obscured text</li>
          <li>• CNIC must not be expired</li>
          <li>• Selfie must show your face clearly holding the CNIC</li>
          <li>• Address proof must be dated within the last 3 months</li>
          <li>• Verification typically takes 2-3 business days</li>
        </ul>
      </div>
    </div>
  );
}
