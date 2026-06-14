import OpenAI from "openai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import fs from 'fs'
import pdf from 'pdf-parse/lib/pdf-parse.js'



import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const generateArticle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, length } = req.body;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== "premium" && free_usage >= 10) {
      return res.json({
        success: false,
        message: "Limit reached. Upgrade to continue.",
      });
    }

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: length,
    });

    const content = completion.choices[0].message.content;

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${prompt}, ${content}, 'article')
    `;

    if (plan !== "premium") {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1,
        },
      });
    }

    res.json({ success: true, content });
  } catch (error) {
    console.log(error);
    res.json({
      success: false,
      message: error.message,
    });
  }
};


export const generateBlogTitle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt } = req.body;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== "premium" && free_usage >= 10) {
      return res.json({
        success: false,
        message: "Limit reached. Upgrade to continue.",
      });
    }

    const finalPrompt = `
      Generate 5 catchy, SEO-friendly blog titles about: ${prompt}

      Requirements:
      - Return only the titles
      - Number each title
      - Keep titles engaging and concise
    `;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: finalPrompt,
        },
      ],
      temperature: 0.8,
      max_tokens: 200,
    });

    const content = completion.choices[0].message.content;

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${prompt}, ${content}, 'blog-title')
    `;

    if (plan !== "premium") {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1,
        },
      });
    }

    res.json({
      success: true,
      content,
    });

  } catch (error) {
    console.log(error);
    res.json({
      success: false,
      message: error.message,
    });
  }
};

import FormData from "form-data";

export const generateImage = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, publish } = req.body;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions"
      });
    }

    // ✅ Create FormData
    const formData = new FormData();
    formData.append("prompt", prompt);

    // 🔥 Call ClipDrop API
    const response = await axios.post(
      "https://clipdrop-api.co/text-to-image/v1",
      formData,
      {
        headers: {
          "x-api-key": process.env.CLIPDROP_API_KEY,
          ...formData.getHeaders()
        },
        responseType: "arraybuffer"
      }
    );

    // ✅ Convert to base64
    const base64Image = `data:image/png;base64,${Buffer.from(response.data).toString("base64")}`;

    // ✅ Upload to Cloudinary
    const { secure_url } = await cloudinary.uploader.upload(base64Image);

    // ✅ Save to DB
    await sql`
      INSERT INTO creations (user_id, prompt, content, type, publish)
      VALUES (${userId}, ${prompt}, ${secure_url}, 'image', ${publish ?? false})
    `;

    res.json({ success: true, content: secure_url });

  } catch (error) {
    console.log("ERROR:", error.response?.data || error.message);

    res.json({
      success: false,
      message: error.response?.data?.message || error.message
    });
  }
};
export const removeImageBackground = async (req, res)=>{
    try {
        const { userId } = req.auth();
        const image = req.file;
        const plan = req.plan;

        if(plan !== 'premium'){
            return res.json({ success: false, message: "This feature is only available for premium subscriptions"})
        }

        const {secure_url} = await cloudinary.uploader.upload(image.path, {
            transformation: [
                {
                    effect: 'background_removal',
                    background_removal: 'remove_the_background'
                }
            ]
        })

        await sql` INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, 'Remove background from image', ${secure_url}, 'image')`;

        res.json({ success: true, content: secure_url})

    } catch (error) {
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}

export const removeImageObject = async (req, res)=>{
    try {
        const { userId } = req.auth();
        const { object } = req.body;
        const image = req.file;
        const plan = req.plan;

        if(plan !== 'premium'){
            return res.json({ success: false, message: "This feature is only available for premium subscriptions"})
        }

        const {public_id} = await cloudinary.uploader.upload(image.path)

        const imageUrl = cloudinary.url(public_id, {
            transformation: [{effect: `gen_remove:${object}`}],
            resource_type: 'image'
        })

        await sql` INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, ${`Removed ${object} from image`}, ${imageUrl}, 'image')`;

        res.json({ success: true, content: imageUrl})

    } catch (error) {
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}

export const resumeReview = async (req, res) => {
    try {
        const { userId } = req.auth();
        const resume = req.file;
        const plan = req.plan;

        if (plan !== "premium") {
            return res.json({
                success: false,
                message: "This feature is only available for premium subscriptions",
            });
        }

        if (!resume) {
            return res.json({
                success: false,
                message: "Please upload a resume.",
            });
        }

        if (resume.size > 5 * 1024 * 1024) {
            return res.json({
                success: false,
                message: "Resume file size exceeds allowed size (5MB).",
            });
        }

        // Read PDF
        const dataBuffer = fs.readFileSync(resume.path);
        const pdfData = await pdf(dataBuffer);

        const finalPrompt = `
You are an expert ATS Resume Reviewer and Career Coach.

Analyze the resume and provide your response in the following format:

# ATS Score
Give a score out of 100.

# Strengths
- Point 1
- Point 2
- Point 3

# Weaknesses
- Point 1
- Point 2
- Point 3

# Missing Skills
Mention important skills that could improve the resume.

# Improvement Suggestions
Provide actionable recommendations.

# Interview Readiness
Rate the candidate out of 10 and explain why.

Resume:
${pdfData.text}
`;

        // Groq API Call
        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content:
                        "You are an expert ATS resume reviewer, recruiter, and career coach.",
                },
                {
                    role: "user",
                    content: finalPrompt,
                },
            ],
            temperature: 0.7,
            max_tokens: 1200,
        });

        const content = completion.choices[0].message.content;

        // Save Review
        await sql`
            INSERT INTO creations (user_id, prompt, content, type)
            VALUES (
                ${userId},
                'Review the uploaded resume',
                ${content},
                'resume-review'
            )
        `;

        res.json({
            success: true,
            content,
        });
    } catch (error) {
        console.error(error);

        res.json({
            success: false,
            message: error.message,
        });
    }
};