﻿using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading;

using OpenTK.Audio.OpenAL;
using Pv;

namespace PorcupineDotnet
{
    public class Mic
    {
        public static void Run(string modelPath, List<string> keywordPaths, List<string> keywords, List<float> sensitivities,
                                   int? audioDeviceIndex = null, string outputPath = null)
        {
            Porcupine porcupine = null;
            BinaryWriter outputFileWriter = null;
            int totalSamplesWritten = 0;
            try
            {
                // init porcupine wake word engine
                porcupine = Porcupine.Create(modelPath, keywordPaths, keywords, sensitivities);

                // get keyword names for labeling detection results
                if (keywords == null)
                {
                    keywords = keywordPaths.Select(k => Path.GetFileNameWithoutExtension(k).Split("_")[0]).ToList();
                }

                // open stream to output file
                if (!string.IsNullOrWhiteSpace(outputPath))
                {
                    outputFileWriter = new BinaryWriter(new FileStream(outputPath, FileMode.OpenOrCreate, FileAccess.Write));
                    WriteWavHeader(outputFileWriter, 1, 16, 16000, 0);
                }

                // choose audio device
                string deviceName = null;
                if (audioDeviceIndex != null)
                {
                    List<string> captureDeviceList = ALC.GetStringList(GetEnumerationStringList.CaptureDeviceSpecifier).ToList();
                    Console.WriteLine(JsonSerializer.Serialize(captureDeviceList));
                    if (captureDeviceList != null && audioDeviceIndex.Value < captureDeviceList.Count)
                    {
                        deviceName = captureDeviceList[audioDeviceIndex.Value];
                    }
                    else
                    {
                        throw new ArgumentException("No input device found with the specified index. Use --show_audio_devices to show" +
                                                    "available inputs", "--audio_device_index");
                    }
                }

                Console.Write("Listening for {");
                for (int i = 0; i < keywords.Count; i++)
                {
                    Console.Write($" {keywords[i]}({sensitivities[i]})");
                }
                Console.Write("  }\n");

                // create and start recording
                short[] recordingBuffer = new short[porcupine.FrameLength];
                ALCaptureDevice captureDevice = ALC.CaptureOpenDevice(deviceName, 16000, ALFormat.Mono16, porcupine.FrameLength * 2);
                {
                    ALC.CaptureStart(captureDevice);
                    while (true)
                    {
                        int samplesAvailable = ALC.GetAvailableSamples(captureDevice);
                        if (samplesAvailable > porcupine.FrameLength)
                        {
                            ALC.CaptureSamples(captureDevice, ref recordingBuffer[0], porcupine.FrameLength);
                            int result = porcupine.Process(recordingBuffer);
                            if (result >= 0)
                            {
                                Console.WriteLine($"[{DateTime.Now.ToLongTimeString()}] Detected '{keywords[result]}'");
                            }

                            if (outputFileWriter != null)
                            {
                                foreach (short sample in recordingBuffer)
                                {
                                    outputFileWriter.Write(sample);
                                }
                                totalSamplesWritten += recordingBuffer.Length;
                            }
                        }
                        Thread.Yield();
                    }

                    // stop and clean up resources
                    Console.WriteLine("Stopping...");
                    ALC.CaptureStop(captureDevice);
                    ALC.CaptureCloseDevice(captureDevice);
                }
            }
            finally
            {
                if (outputFileWriter != null)
                {
                    // write size to header and clean up
                    WriteWavHeader(outputFileWriter, 1, 16, 16000, totalSamplesWritten);
                    outputFileWriter.Flush();
                    outputFileWriter.Dispose();
                }
                porcupine?.Dispose();
            }
        }

        private static void WriteWavHeader(BinaryWriter writer, ushort channelCount, ushort bitDepth, int sampleRate, int totalSampleCount)
        {
            if (writer == null)
                return;

            writer.Seek(0, SeekOrigin.Begin);
            writer.Write(Encoding.ASCII.GetBytes("RIFF"));
            writer.Write((bitDepth / 8 * totalSampleCount) + 36);
            writer.Write(Encoding.ASCII.GetBytes("WAVE"));
            writer.Write(Encoding.ASCII.GetBytes("fmt "));
            writer.Write(16);
            writer.Write((ushort)1);
            writer.Write(channelCount);
            writer.Write(sampleRate);
            writer.Write(sampleRate * channelCount * bitDepth / 8);
            writer.Write((ushort)(channelCount * bitDepth / 8));
            writer.Write(bitDepth);
            writer.Write(Encoding.ASCII.GetBytes("data"));
            writer.Write(bitDepth / 8 * totalSampleCount);
        }

        public static void ShowAudioDevices()
        {
            Console.WriteLine("Available audio devices: \n");
            List<string> captureDeviceList = ALC.GetStringList(GetEnumerationStringList.CaptureDeviceSpecifier).ToList();
            for (int i = 0; i < captureDeviceList.Count; i++)
            {
                Console.WriteLine($"\tDevice {i}: {captureDeviceList[i]}");
            }
        }

        public static void Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
            Console.WriteLine(HELP_STR);
            if (args.Length == 0)
            {
                Console.WriteLine(HELP_STR);
                if (!Console.IsInputRedirected)
                {
                    Console.ReadKey();  // Only read key if console input is not redirected
                }
                return;
            }

            List<string> keywords = null;
            List<string> keywordPaths = null;
            List<float> sensitivities = null;
            string modelPath = null;
            int? audioDeviceIndex = null;
            string outputPath = null;
            bool showAudioDevices = false;
            bool showHelp = false;

            // parse command line arguments
            int argIndex = 0;
            while (argIndex < args.Length)
            {
                if (args[argIndex] == "--keywords")
                {
                    argIndex++;
                    keywords = new List<string>();
                    while (argIndex < args.Length && !args[argIndex].StartsWith("--"))
                    {
                        keywords.Add(args[argIndex++]);
                    }
                }
                else if (args[argIndex] == "--keyword_paths")
                {
                    argIndex++;
                    keywordPaths = new List<string>();
                    while (argIndex < args.Length && !args[argIndex].StartsWith("--"))
                    {
                        keywordPaths.Add(args[argIndex++]);
                    }
                }
                else if (args[argIndex] == "--model_path")
                {
                    if (++argIndex < args.Length)
                    {
                        modelPath = args[argIndex++];
                    }
                }
                else if (args[argIndex] == "--sensitivities")
                {
                    argIndex++;
                    sensitivities = new List<float>();
                    while (argIndex < args.Length && !args[argIndex].StartsWith("--") &&
                           float.TryParse(args[argIndex], out float sensitivity))
                    {
                        sensitivities.Add(sensitivity);
                        argIndex++;
                    }
                }
                else if (args[argIndex] == "--show_audio_devices")
                {
                    showAudioDevices = true;
                    argIndex++;
                }
                else if (args[argIndex] == "--audio_device_index")
                {
                    if (++argIndex < args.Length && int.TryParse(args[argIndex], out int deviceIdx))
                    {
                        audioDeviceIndex = deviceIdx;
                        argIndex++;
                    }
                }
                else if (args[argIndex] == "--output_path")
                {
                    if (++argIndex < args.Length)
                    {
                        outputPath = args[argIndex++];
                    }
                }
                else if (args[argIndex] == "-h" || args[argIndex] == "--help")
                {
                    showHelp = true;
                    argIndex++;
                }
                else
                {
                    argIndex++;
                }
            }

            // print help text and exit
            if (showHelp)
            {
                Console.WriteLine(HELP_STR);
                if (!Console.IsInputRedirected)
                {
                    Console.ReadKey();  // Only read key if console input is not redirected
                }
                return;
            }

            // print audio device info and exit
            if (showAudioDevices)
            {
                ShowAudioDevices();
                if (!Console.IsInputRedirected)
                {
                    Console.ReadKey();  // Only read key if console input is not redirected
                }
                return;
            }

            // argument validation
            if ((keywordPaths == null || keywordPaths.Count == 0) && (keywords == null || keywords.Count == 0))
            {
                throw new ArgumentNullException("keywords", "Either '--keywords' or '--keyword_paths' must be set.");
            }

            int keywordCount = keywordPaths?.Count ?? keywords.Count;

            if (sensitivities == null)
            {
                sensitivities = Enumerable.Repeat(0.5f, keywordCount).ToList();
            }

            if (sensitivities.Count != keywordCount)
            {
                throw new ArgumentException($"Number of keywords ({keywordCount}) does not match number of sensitivities ({sensitivities.Count})");
            }

            // run with validated arguments
            Run(modelPath, keywordPaths, keywords, sensitivities, audioDeviceIndex, outputPath);
        }

        private static void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
        {
            Console.WriteLine(e.ExceptionObject.ToString());
            if (!Console.IsInputRedirected)
            {
                Console.ReadKey();  // Only read key if console input is not redirected
            }
            Environment.Exit(-1);
        }

        private static readonly string HELP_STR = "Available options: \n " +
            $"\t--keywords: List of default keywords for detection. Available keywords: {string.Join(", ", Porcupine.KEYWORDS)}\n" +
            $"\t--keyword_paths: Absolute paths to keyword model files. If not set it will be populated from `--keywords` argument\n" +
            $"\t--model_path: Absolute path to the file containing model parameters.\n" +
            $"\t--sensitivities: Sensitivities for detecting keywords. Each value should be a number within [0, 1]. A higher \n" +
             "\t\tsensitivity results in fewer misses at the cost of increasing the false alarm rate. If not set 0.5 will be used.\n" +
            "\t--audio_device_index: Index of input audio device.\n" +
            "\t--output_path: Absolute path to recorded audio for debugging.\n" +
            "\t--show_audio_devices: Print available recording devices.\n";
    }
}
