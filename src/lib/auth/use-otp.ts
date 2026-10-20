"use client";

import { useState } from "react";

export function useOtp() {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneMasked, setPhoneMasked] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const requestOtp = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to request OTP");
      }

      setPhoneMasked(data.maskedPhone);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error requesting OTP");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, code }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to verify OTP");
      }

      localStorage.setItem("auth_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      localStorage.setItem("user_id", data.user_id);

      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error verifying OTP");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep("phone");
    setPhoneNumber("");
    setPhoneMasked("");
    setCode("");
    setError("");
  };

  return {
    step,
    phoneNumber,
    setPhoneNumber,
    phoneMasked,
    code,
    setCode,
    loading,
    error,
    requestOtp,
    verifyOtp,
    reset,
  };
}
