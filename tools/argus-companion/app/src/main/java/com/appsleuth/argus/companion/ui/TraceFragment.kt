package com.appsleuth.argus.companion.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import com.appsleuth.argus.companion.R
import com.appsleuth.argus.companion.databinding.FragmentTraceBinding
import com.appsleuth.argus.companion.recorder.FlightRecorder
import com.appsleuth.argus.companion.service.ArgusAccessibilityService
import com.appsleuth.argus.companion.service.ArgusVpnService

class TraceFragment : Fragment() {

    private var _binding: FragmentTraceBinding? = null
    private val binding get() = _binding!!
    private lateinit var adapter: FlightEventAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentTraceBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        adapter = FlightEventAdapter()
        val layoutManager = LinearLayoutManager(requireContext()).apply {
            stackFromEnd = true
        }
        binding.rvEvents.layoutManager = layoutManager
        binding.rvEvents.adapter = adapter

        FlightRecorder.events.observe(viewLifecycleOwner) { events ->
            adapter.submitList(events) {
                if (events.isNotEmpty()) {
                    binding.rvEvents.scrollToPosition(events.size - 1)
                }
            }

            binding.tvTraceCount.text = "${events.size} events captured"
            binding.tvEmpty.visibility = if (events.isEmpty()) View.VISIBLE else View.GONE
            binding.rvEvents.visibility = if (events.isEmpty()) View.GONE else View.VISIBLE
        }

        binding.btnClearTrace.setOnClickListener {
            FlightRecorder.clear()
        }

        binding.btnToggleMonitoring.setOnClickListener {
            val activity = requireActivity() as? MainActivity ?: return@setOnClickListener
            val isMonitoring = ArgusVpnService.isRunning || ArgusAccessibilityService.isRunning

            if (isMonitoring) {
                activity.stopVpnService()
            } else {
                if (!ArgusAccessibilityService.isRunning) {
                    activity.openAccessibilitySettings()
                }
                activity.requestVpnPermission()
            }
            updateButtonState()
        }
    }

    override fun onResume() {
        super.onResume()
        updateButtonState()
    }

    private fun updateButtonState() {
        val isMonitoring = ArgusVpnService.isRunning || ArgusAccessibilityService.isRunning
        binding.btnToggleMonitoring.text = if (isMonitoring) {
            getString(R.string.btn_stop_monitoring)
        } else {
            getString(R.string.btn_start_monitoring)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
