package com.appsleuth.argus.companion.ui

import android.content.Context
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.appsleuth.argus.companion.R
import com.appsleuth.argus.companion.databinding.FragmentDiagnoseBinding
import com.appsleuth.argus.companion.diagnosis.GeminiDiagnosticEngine
import com.appsleuth.argus.companion.recorder.FlightRecorder
import kotlinx.coroutines.launch

class DiagnoseFragment : Fragment() {

    private var _binding: FragmentDiagnoseBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentDiagnoseBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.btnDiagnose.setOnClickListener {
            val complaint = binding.etComplaint.text?.toString()?.trim() ?: ""
            if (complaint.isBlank()) {
                binding.etComplaint.error = "Please describe the problem you experienced"
                return@setOnClickListener
            }

            performDiagnosis(complaint)
        }
    }

    private fun performDiagnosis(complaint: String) {
        val prefs = requireContext().getSharedPreferences("argus_prefs", Context.MODE_PRIVATE)
        val apiKey = prefs.getString("gemini_api_key", null)

        binding.btnDiagnose.isEnabled = false
        binding.btnDiagnose.text = getString(R.string.btn_diagnosing)
        binding.progressBar.visibility = View.VISIBLE
        binding.cardResult.visibility = View.VISIBLE
        binding.tvUserExplanation.text = "Analysing captured flight events and synthesizing causal journey..."
        binding.layoutTechnicalCause.visibility = View.GONE
        binding.layoutDivergence.visibility = View.GONE

        val snapshotEvents = FlightRecorder.getSnapshot()

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val result = GeminiDiagnosticEngine.diagnose(
                    userComplaint = complaint,
                    events = snapshotEvents,
                    apiKey = apiKey
                )

                binding.tvReportEngineBadge.text = result.engine
                binding.tvUserExplanation.text = result.userFacingExplanation

                if (result.technicalRootCause.isNotBlank()) {
                    binding.layoutTechnicalCause.visibility = View.VISIBLE
                    binding.tvTechnicalCause.text = result.technicalRootCause
                }

                if (!result.divergedAtStep.isNullOrBlank()) {
                    binding.layoutDivergence.visibility = View.VISIBLE
                    binding.tvDivergedStep.text = result.divergedAtStep
                }
            } catch (e: Exception) {
                binding.tvUserExplanation.text = "Diagnosis encountered an unexpected issue: ${e.message}\n\nPlease verify network connection or Gemini API key."
            } finally {
                binding.progressBar.visibility = View.GONE
                binding.btnDiagnose.isEnabled = true
                binding.btnDiagnose.text = getString(R.string.btn_diagnose)
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
