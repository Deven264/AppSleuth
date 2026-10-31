package com.appsleuth.argus.companion.ui

import android.content.Context
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import com.appsleuth.argus.companion.R
import com.appsleuth.argus.companion.databinding.FragmentSettingsBinding
import com.appsleuth.argus.companion.service.ArgusAccessibilityService
import com.appsleuth.argus.companion.service.ArgusVpnService

class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val prefs = requireContext().getSharedPreferences("argus_prefs", Context.MODE_PRIVATE)
        val savedKey = prefs.getString("gemini_api_key", "")
        binding.etSettingsApiKey.setText(savedKey)

        binding.btnOpenAccessibilitySettings.setOnClickListener {
            val activity = requireActivity() as? MainActivity
            activity?.openAccessibilitySettings()
        }

        binding.btnToggleVpnService.setOnClickListener {
            val activity = requireActivity() as? MainActivity ?: return@setOnClickListener
            if (ArgusVpnService.isRunning) {
                activity.stopVpnService()
            } else {
                activity.requestVpnPermission()
            }
            updateVpnButtonState()
        }

        binding.btnSaveApiKey.setOnClickListener {
            val key = binding.etSettingsApiKey.text?.toString()?.trim() ?: ""
            prefs.edit().putString("gemini_api_key", key).apply()
            Toast.makeText(
                requireContext(),
                if (key.isNotBlank()) "Gemini API key saved successfully!" else "API key cleared. Offline heuristic mode active.",
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    override fun onResume() {
        super.onResume()
        updateVpnButtonState()
    }

    private fun updateVpnButtonState() {
        binding.btnToggleVpnService.text = if (ArgusVpnService.isRunning) {
            "Stop Network Monitor"
        } else {
            getString(R.string.btn_open_vpn)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
